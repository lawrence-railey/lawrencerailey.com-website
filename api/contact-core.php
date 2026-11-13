<?php
declare(strict_types=1);

/** No submitted values are used as recipients, SMTP settings, or file paths. */
function contact_validate(array $input): array
{
    $limits = ['name' => 100, 'email' => 254, 'message' => 5000];
    $values = [];
    $errors = [];
    foreach ($limits as $key => $limit) {
        $value = $input[$key] ?? '';
        if (!is_string($value) || !preg_match('//u', $value)) {
            $errors[$key] = 'Please enter valid text.';
            continue;
        }
        $value = trim(str_replace(["\r\n", "\r"], "\n", $value));
        $length = preg_match_all('/./us', $value);
        if ($value === '' || $length > $limit) {
            $errors[$key] = $value === '' ? 'Please complete this field.' : "Please use $limit characters or fewer.";
        } elseif ($key !== 'message' && preg_match('/[\x00-\x1F\x7F]/', $value)) {
            $errors[$key] = 'Please enter a single line.';
        } elseif ($key === 'email' && !filter_var($value, FILTER_VALIDATE_EMAIL)) {
            $errors[$key] = 'Please enter a valid email address.';
        } elseif ($key === 'message' && preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
            $errors[$key] = 'Please remove unsupported characters.';
        }
        $values[$key] = $value;
    }
    return [$values, $errors];
}

function contact_settings(array $config): bool
{
    foreach (['host', 'username', 'password', 'from', 'to', 'origin'] as $key) {
        if (!isset($config[$key]) || !is_string($config[$key]) || trim($config[$key]) === '') return false;
    }
    return filter_var($config['from'], FILTER_VALIDATE_EMAIL) !== false
        && filter_var($config['to'], FILTER_VALIDATE_EMAIL) !== false
        && in_array($config['encryption'] ?? '', ['ssl', 'tls'], true)
        && is_int($config['port'] ?? null) && $config['port'] > 0 && $config['port'] <= 65535;
}

/** Lock a small private state file; retain only one hour of hashed metadata. */
function contact_state(string $directory, callable $operation)
{
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('State directory unavailable.');
    }
    $file = fopen($directory . '/requests.json', 'c+');
    if (!$file || !flock($file, LOCK_EX)) throw new RuntimeException('State unavailable.');
    try {
        @chmod($directory . '/requests.json', 0600);
        $raw = stream_get_contents($file);
        $state = $raw === '' ? ['attempts' => [], 'requests' => []] : json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        $cutoff = time() - 3600;
        $state['attempts'] = array_values(array_filter($state['attempts'], fn($a) => $a['time'] > $cutoff));
        $state['requests'] = array_filter($state['requests'], fn($r) => $r['time'] > $cutoff);
        $result = $operation($state);
        $encoded = json_encode($state, JSON_THROW_ON_ERROR);
        rewind($file);
        if (!ftruncate($file, 0) || fwrite($file, $encoded) !== strlen($encoded) || !fflush($file)) {
            throw new RuntimeException('State write failed.');
        }
        return $result;
    } finally {
        flock($file, LOCK_UN);
        fclose($file);
    }
}

function contact_reserve(string $directory, string $ip, string $id, string $digest): string
{
    return contact_state($directory, function (&$state) use ($ip, $id, $digest) {
        if (isset($state['requests'][$id])) {
            $previous = $state['requests'][$id];
            if (!hash_equals($previous['digest'], $digest)) return 'conflict';
            return $previous['status'];
        }
        $sameIp = array_filter($state['attempts'], fn($a) => $a['ip'] === $ip);
        if (count($sameIp) >= 5 || count($state['attempts']) >= 30) return 'limited';
        $state['attempts'][] = ['ip' => $ip, 'time' => time()];
        $state['requests'][$id] = ['digest' => $digest, 'status' => 'pending', 'time' => time()];
        return 'reserved';
    });
}

function contact_finish(string $directory, string $id, string $status): void
{
    contact_state($directory, function (&$state) use ($id, $status) {
        if (isset($state['requests'][$id])) $state['requests'][$id]['status'] = $status;
    });
}
