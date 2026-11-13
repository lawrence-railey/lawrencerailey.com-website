(() => {
  const form = document.querySelector('.contact-form[data-mailer]');
  if (!form) return;
  const button = form.querySelector('.contact-submit');
  const label = button.querySelector('.contact-submit-label');
  const status = form.querySelector('.contact-status');
  const statusText = status.querySelector('.contact-status-text');
  const directLink = status.querySelector('.contact-direct-link');
  const fields = ['name', 'email', 'message'].map(name => form.elements.namedItem(name));
  let pending = false;
  let lastPayload = '';
  let requestId = '';
  let tokenPromise;

  function announce(state, text, direct = false) {
    status.dataset.state = state;
    statusText.textContent = text;
    directLink.hidden = !direct;
    status.hidden = false;
  }
  async function request(options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(form.action, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: {Accept: 'application/json', ...(options.body ? {'Content-Type': 'application/json'} : {})},
        ...options,
      });
      const body = await response.json();
      return {response, body};
    } finally { clearTimeout(timer); }
  }
  function prepareToken() {
    if (!tokenPromise) {
      tokenPromise = request().then(({response, body}) => {
        if (!response.ok || !body.ok || typeof body.token !== 'string') throw new Error('Unavailable');
        return body.token;
      }).catch(error => { tokenPromise = null; throw error; });
    }
    return tokenPromise;
  }
  function clearErrors() {
    fields.forEach(field => {
      field.removeAttribute('aria-invalid');
      document.getElementById(`${field.id}-error`).textContent = '';
    });
  }
  form.addEventListener('input', event => {
    const field = event.target;
    if (fields.includes(field)) {
      field.removeAttribute('aria-invalid');
      document.getElementById(`${field.id}-error`).textContent = '';
      if (status.dataset.state === 'success') status.hidden = true;
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    pending = true;
    clearErrors();
    const values = Object.fromEntries(fields.map(field => [field.name, field.value.trim()]));
    const fingerprint = JSON.stringify(values);
    if (fingerprint !== lastPayload) {
      requestId = crypto.randomUUID();
      lastPayload = fingerprint;
    }
    button.disabled = true;
    label.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    fields.forEach(field => { field.readOnly = true; });
    announce('sending', 'Sending your message…');
    try {
      const token = await prepareToken();
      const {response, body} = await request({method: 'POST', body: JSON.stringify({
        ...values, token, requestId, website: form.elements.namedItem('website').value,
      })});
      if (response.ok && body.ok === true) {
        form.reset();
        lastPayload = '';
        announce('success', 'Message sent. Thanks for reaching out—I’ll get back to you soon.');
        status.focus({preventScroll: true});
      } else {
        if (response.status === 403) tokenPromise = null;
        if (body.errors && typeof body.errors === 'object') {
          fields.forEach(field => {
            if (typeof body.errors[field.name] !== 'string') return;
            field.setAttribute('aria-invalid', 'true');
            document.getElementById(`${field.id}-error`).textContent = body.errors[field.name];
          });
        }
        announce('error', body.message || 'We couldn’t confirm your message was sent. Please try again or email me directly.', true);
        (fields.find(field => field.getAttribute('aria-invalid') === 'true') || status).focus({preventScroll: true});
      }
    } catch {
      announce('error', 'We couldn’t confirm your message was sent. Please try again or email me directly.', true);
      status.focus({preventScroll: true});
    } finally {
      pending = false;
      button.disabled = false;
      label.textContent = 'Send message';
      form.removeAttribute('aria-busy');
      fields.forEach(field => { field.readOnly = false; });
    }
  });
  button.disabled = false;
  prepareToken().catch(() => {}); // Retry on submit if the initial connection failed.
})();
