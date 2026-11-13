<?php
declare(strict_types=1);

use PHPMailer\PHPMailer\PHPMailer;

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

$genericError = 'We couldn’t confirm your message was sent. Please try again or email me directly.';
$stage = 'configuration';
try {
    require __DIR__ . '/contact-core.php';
    // Bluehost: /home2/lawreod5/portfolio-contact/config.php, outside public_html.
    $private = getenv('PORTFOLIO_CONTACT_DIR') ?: dirname(__DIR__, 3) . '/portfolio-contact';
    $config = is_file($private . '/config.php') ? require $private . '/config.php' : [];
    if (!is_array($config) || !contact_settings($config)) {
        respond(503, ['ok' => false, 'message' => 'The form is temporarily unavailable. Please email me directly.']);
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($method, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        respond(405, ['ok' => false, 'message' => 'Unsupported request.']);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (($origin !== '' && $origin !== $config['origin']) || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
        respond(403, ['ok' => false, 'message' => 'Please send your message from the contact page.']);
    }
    $stage = 'session';
    session_name('portfolio_contact');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME']))), '/') . '/',
        'secure' => str_starts_with($config['origin'], 'https://'), 'httponly' => true, 'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    if (!session_start()) throw new RuntimeException('Session unavailable.');
    if (!isset($_SESSION['contact_token'])) $_SESSION['contact_token'] = bin2hex(random_bytes(32));
    $token = $_SESSION['contact_token'];
    session_write_close();
    if ($method === 'GET') respond(200, ['ok' => true, 'token' => $token]);

    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) respond(413, ['ok' => false, 'message' => 'Your message is too long.']);
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') {
        respond(415, ['ok' => false, 'message' => 'Please send your message from the contact page.']);
    }
    $raw = file_get_contents('php://input', false, null, 0, 32769);
    if (strlen($raw) > 32768) respond(413, ['ok' => false, 'message' => 'Your message is too long.']);
    $input = json_decode($raw, true);
    if (!is_array($input)) respond(400, ['ok' => false, 'message' => 'Please check your message and try again.']);
    if (!is_string($input['token'] ?? null) || !hash_equals($token, $input['token'])) {
        respond(403, ['ok' => false, 'message' => 'Your session expired. Please try sending again.']);
    }
    if (!is_string($input['website'] ?? '') || trim($input['website'] ?? '') !== '') {
        respond(422, ['ok' => false, 'message' => 'Please check your message and try again.']);
    }
    $id = $input['requestId'] ?? '';
    if (!is_string($id) || !preg_match('/^[a-f0-9-]{36}$/D', $id)) {
        respond(400, ['ok' => false, 'message' => 'Please reload the page and try again.']);
    }
    [$values, $errors] = contact_validate($input);
    if ($errors) respond(422, ['ok' => false, 'message' => 'Please check the highlighted fields.', 'errors' => $errors]);
    $ip = hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown', $config['password']);
    $id = hash_hmac('sha256', $id, $token);
    $digest = hash_hmac('sha256', json_encode($values), $config['password']);
    $stage = 'request-state';
    $reservation = contact_reserve($private, $ip, $id, $digest);
    if ($reservation === 'sent') respond(200, ['ok' => true]);
    if ($reservation === 'limited') {
        header('Retry-After: 3600');
        respond(429, ['ok' => false, 'message' => 'Please wait an hour before sending another message, or email me directly.']);
    }
    if ($reservation !== 'reserved') {
        respond(409, ['ok' => false, 'message' => 'This message may already be on its way. Please wait, or email me directly.']);
    }
    $stage = 'mailer-load';
    require __DIR__ . '/vendor/phpmailer/src/Exception.php';
    require __DIR__ . '/vendor/phpmailer/src/PHPMailer.php';
    require __DIR__ . '/vendor/phpmailer/src/SMTP.php';
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = $config['host'];
    $mail->Port = $config['port'];
    $mail->SMTPAuth = true;
    $mail->Username = $config['username'];
    $mail->Password = $config['password'];
    $mail->SMTPSecure = $config['encryption'];
    $mail->SMTPDebug = 0;
    $mail->Timeout = 10;
    $mail->getSMTPInstance()->Timelimit = 20;
    $mail->CharSet = 'UTF-8';
    $mail->setFrom($config['from'], 'Lawrence Railey — Portfolio');
    $mail->addAddress($config['to'], 'Lawrence Railey');
    $mail->addReplyTo($values['email'], $values['name']);
    $mail->Subject = 'Portfolio inquiry from ' . $values['name'];
    $mail->isHTML(false);
    $mail->Body = "New portfolio inquiry\n\nName: {$values['name']}\nEmail: {$values['email']}\n\n{$values['message']}\n\n—\nSent from the portfolio contact form.";
    $stage = 'smtp-send';
    if (!$mail->send()) throw new RuntimeException('SMTP send failed.');
    $stage = 'record-sent';
    contact_finish($private, $id, 'sent');
    respond(200, ['ok' => true]);
} catch (Throwable $error) {
    // Leave uncertain requests reserved: a retry cannot send an accidental duplicate.
    // Do not expose credentials, message contents, or SMTP conversation logs.
    $reason = 'unexpected';
    $description = strtolower($error->getMessage());
    foreach (['authenticate' => 'smtp-authentication', 'certificate' => 'tls-certificate',
        'connect' => 'smtp-connection', 'extension missing' => 'missing-extension',
        'undefined function' => 'missing-function', 'failed opening' => 'missing-file',
        'state' => 'private-state', 'data not accepted' => 'smtp-data-rejected'] as $needle => $category) {
        if (str_contains($description, $needle)) { $reason = $category; break; }
    }
    $diagnostic = ['time' => gmdate('c'), 'stage' => $stage, 'reason' => $reason,
        'reference' => substr($id ?? 'setup', 0, 12)];
    if (isset($private) && is_dir($private)) {
        $previousMask = umask(0077);
        @file_put_contents($private . '/last-error.json', json_encode($diagnostic), LOCK_EX);
        umask($previousMask);
    }
    error_log('Portfolio contact request failed; reference ' . $diagnostic['reference']);
    respond(503, ['ok' => false, 'message' => $genericError]);
}
