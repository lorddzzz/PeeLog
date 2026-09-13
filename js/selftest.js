// Diagnostics for the M0 install check. Every row here is something M1+
// depends on, phrased so it can be read on the phone at a glance.

const ok = (k, v) => ({ k, v, s: 'ok' });
const warn = (k, v) => ({ k, v, s: 'warn' });
const bad = (k, v) => ({ k, v, s: 'bad' });

const ICON = { ok: '✅', warn: '⚠️', bad: '❌' };

function bytes(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

export async function runChecks(version) {
  const out = [];

  // Installed as a home-screen app? Browser tabs get evicted far sooner.
  const standalone = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  out.push(standalone
    ? ok('Running installed', 'Launched from the home screen')
    : warn('Running in browser', 'Use Share → Add to Home Screen, then reopen from the icon'));

  // Service worker: registered is not enough — it must be *controlling*
  // this page, which only happens on the second load after install.
  if (!('serviceWorker' in navigator)) {
    out.push(bad('Service worker', 'Not supported'));
  } else {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) out.push(bad('Service worker', 'Not registered'));
    else if (!navigator.serviceWorker.controller)
      out.push(warn('Service worker', 'Registered but not controlling yet — reload once'));
    else out.push(ok('Service worker', `Controlling · scope ${new URL(reg.scope).pathname}`));
  }

  // Offline shell: the actual guarantee that the app opens at 3am on a dead
  // connection is the number of files sitting in the cache.
  if ('caches' in window) {
    const names = await caches.keys();
    let n = 0;
    for (const name of names) n += (await (await caches.open(name)).keys()).length;
    out.push(n > 0
      ? ok('Offline shell cached', `${n} files · ${names.join(', ') || 'none'}`)
      : warn('Offline shell cached', 'Nothing cached yet — reload once'));
  } else {
    out.push(bad('Cache API', 'Not supported'));
  }

  // Persistent storage: the difference between "the OS may evict your data"
  // and "it may not". Safari grants this sparingly.
  if (navigator.storage?.persisted) {
    const p = await navigator.storage.persisted();
    out.push(p
      ? ok('Storage persisted', 'Data is protected from automatic eviction')
      : warn('Storage persisted', 'Not granted — back up weekly (see Design §9)'));
  } else {
    out.push(warn('Storage persisted', 'API unavailable — back up weekly'));
  }

  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    out.push(ok('Storage quota', `${bytes(usage)} used of ${bytes(quota)}`));
  }

  // localStorage is the M1 store. A private-browsing window throws here.
  try {
    const key = '__peelog_probe__';
    localStorage.setItem(key, '1');
    const got = localStorage.getItem(key);
    localStorage.removeItem(key);
    out.push(got === '1'
      ? ok('localStorage', 'Read/write round-trip passed')
      : bad('localStorage', 'Round-trip failed'));
  } catch (err) {
    out.push(bad('localStorage', `Unavailable: ${err.name}`));
  }

  out.push(navigator.onLine
    ? ok('Network', 'Online — now try Airplane Mode and relaunch')
    : ok('Network', 'Offline — and the app still opened. This is the real test.'));

  // Confirms the layout clears the notch and the home indicator.
  const cs = getComputedStyle(document.documentElement);
  const top = cs.getPropertyValue('--safe-top').trim();
  const bot = cs.getPropertyValue('--safe-bot').trim();
  out.push(ok('Safe area', `top ${top || '0px'} · bottom ${bot || '0px'}`));

  out.push(ok('Viewport', `${innerWidth}×${innerHeight} @${devicePixelRatio}x`));

  // Expected to fail on iOS. Recorded so the finding is explicit rather than
  // discovered later as "the buttons don't buzz".
  out.push('vibrate' in navigator
    ? ok('Vibration', 'Supported — haptic tap confirmation available')
    : warn('Vibration', 'Unsupported (normal on iOS) — confirmation must be visual'));

  out.push(ok('Build', version));
  return out;
}

export function renderChecks(el, rows) {
  el.replaceChildren(...rows.map(r => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = ICON[r.s];
    const dd = document.createElement('dd');
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = r.k;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = r.v;
    dd.append(k, v);
    div.append(dt, dd);
    return div;
  }));
}
