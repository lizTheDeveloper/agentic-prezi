// Vanilla SPA — no framework, native ES modules. Talks to the JSON API only.
// Routes: '/' (login or dashboard), '/auth/verify?token=…', '/editor/:id'.

const appEl = document.getElementById('app');
const navEl = document.getElementById('nav');

// --- tiny API client (sends the CSRF custom header; cookies ride along same-origin) ---
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'X-Requested-With': 'fetch' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// --- helpers ---
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) node.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ''));
  return node;
};
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
const navigate = (path) => { history.pushState({}, '', path); render(); };

function notice(msg, kind) {
  return el('div', { class: `notice ${kind || ''}` }, msg);
}

// --- session state ---
let currentUser = null;
async function loadUser() {
  try { currentUser = (await api('GET', '/api/me')).user; }
  catch { currentUser = null; }
  renderNav();
}

function renderNav() {
  clear(navEl);
  if (currentUser) {
    navEl.append(
      el('span', { class: 'muted' }, currentUser.email),
      el('button', { class: 'secondary', onclick: async () => {
        let r; try { r = await api('POST', '/api/auth/logout'); } catch { r = {}; }
        currentUser = null;
        if (r && r.redirect) location.href = r.redirect; else navigate('/');
      } }, 'Sign out'),
    );
  }
}

// --- views ---
async function viewLogin() {
  clear(appEl);
  // Auth is The Multiverse School SSO — bounce the browser to the School login, returning here.
  let loginUrl = null;
  try { loginUrl = (await api('GET', '/api/auth/login-url')).loginUrl; } catch { /* offline */ }
  const go = () => {
    if (!loginUrl) return;
    location.href = loginUrl + (loginUrl.includes('?') ? '&' : '?') + 'next=' + encodeURIComponent(location.origin + '/');
  };
  appEl.append(
    el('h1', {}, 'Sign in'),
    el('p', { class: 'muted' }, 'Aethrix uses your themultiverse.school account.'),
    el('div', { class: 'row' }, el('button', { onclick: go }, 'Continue with The Multiverse School')),
  );
}

async function viewDashboard() {
  clear(appEl);
  appEl.append(el('h1', {}, 'Your presentations'));
  const listWrap = el('div');
  appEl.append(listWrap);

  const title = el('input', { type: 'text', placeholder: 'Presentation title' });
  const writeup = el('textarea', { placeholder: 'Paste or write your write-up here…' });
  const status = el('div');
  appEl.append(
    el('h2', {}, 'New presentation'),
    el('label', {}, 'Title'), title,
    el('label', {}, 'Write-up'), writeup,
    el('div', { class: 'row' }, el('button', {
      onclick: async () => {
        clear(status);
        try {
          const r = await api('POST', '/api/presentations', { title: title.value, sourceWriteup: writeup.value });
          navigate('/editor/' + r.presentation.id);
        } catch (err) { status.append(notice(err.message, 'error')); }
      },
    }, 'Create draft')),
    status,
  );

  try {
    const { presentations } = await api('GET', '/api/presentations');
    clear(listWrap);
    if (presentations.length === 0) {
      listWrap.append(el('p', { class: 'muted' }, 'No presentations yet — create one below.'));
    }
    for (const p of presentations) {
      listWrap.append(el('a', { class: 'card', href: '/editor/' + p.id, 'data-link': '' },
        el('div', { class: 'row', style: 'justify-content: space-between; margin: 0' },
          el('strong', {}, p.title),
          el('span', { class: 'badge ' + p.status }, p.status)),
      ));
    }
  } catch (err) {
    listWrap.append(notice(err.message, 'error'));
  }
}

async function viewEditor(id) {
  clear(appEl);
  appEl.append(el('h1', {}, 'Edit presentation'));
  let poll = null;
  const status = el('div');

  let p;
  try { p = (await api('GET', '/api/presentations/' + id)).presentation; }
  catch (err) { appEl.append(notice(err.message, 'error')); return; }

  const title = el('input', { type: 'text', value: p.title });
  const writeup = el('textarea', {}); writeup.value = p.sourceWriteup;
  const badge = el('span', { class: 'badge ' + p.status }, p.status);
  const linkWrap = el('div');

  function showLink(pres) {
    clear(linkWrap);
    if (pres.status === 'published' && pres.url) {
      linkWrap.append(notice('', 'ok'));
      linkWrap.firstChild.append('Published at ', el('a', { href: pres.url, target: '_blank', rel: 'noopener' }, pres.url));
    } else if (pres.status === 'failed') {
      linkWrap.append(notice('Generation failed. Edit and publish again.', 'error'));
    }
  }
  showLink(p);

  async function refresh() {
    const pres = (await api('GET', '/api/presentations/' + id)).presentation;
    clear(badge); badge.className = 'badge ' + pres.status; badge.append(pres.status);
    showLink(pres);
    if (pres.status === 'published' || pres.status === 'failed') { clearInterval(poll); poll = null; }
  }

  appEl.append(
    el('div', { class: 'row', style: 'margin:0' }, el('span', { class: 'muted' }, 'Status:'), badge),
    el('label', {}, 'Title'), title,
    el('label', {}, 'Write-up'), writeup,
    el('div', { class: 'row' },
      el('button', { class: 'secondary', onclick: async () => {
        clear(status);
        try { await api('PATCH', '/api/presentations/' + id, { title: title.value, sourceWriteup: writeup.value });
          status.append(notice('Saved.', 'ok')); }
        catch (err) { status.append(notice(err.message, 'error')); }
      } }, 'Save'),
      el('button', { onclick: async () => {
        clear(status);
        try {
          await api('PATCH', '/api/presentations/' + id, { title: title.value, sourceWriteup: writeup.value });
          await api('POST', '/api/presentations/' + id + '/publish');
          status.append(notice('Publishing… this updates automatically.', 'ok'));
          if (!poll) poll = setInterval(() => refresh().catch(() => {}), 1000);
        } catch (err) { status.append(notice(err.message, 'error')); }
      } }, 'Publish'),
      el('a', { href: '/', 'data-link': '', class: 'muted' }, '← All presentations'),
    ),
    status,
    linkWrap,
  );

  if (p.status === 'queued' || p.status === 'generating') {
    poll = setInterval(() => refresh().catch(() => {}), 1000);
  }
}

// --- router ---
async function render() {
  const path = location.pathname;
  if (currentUser === null) await loadUser();
  if (!currentUser) return viewLogin();

  const m = path.match(/^\/editor\/(\d+)$/);
  if (m) return viewEditor(m[1]);
  return viewDashboard();
}

// Intercept in-app links for client-side routing.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && a.origin === location.origin) { e.preventDefault(); navigate(a.getAttribute('href')); }
});
window.addEventListener('popstate', render);

await loadUser();
render();
