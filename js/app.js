// PeeLog M0 — app shell. No persistence yet; see docs/DESIGN.md for the plan.
import { runChecks, renderChecks } from './selftest.js';

export const VERSION = '0.1.0-m0';

/* ── Service worker ─────────────────────────────────────────────────────
   Registered with a relative path so the scope follows the deploy
   directory. GitHub Pages serves project sites from /<repo>/, so nothing
   here may use a root-absolute path. */
let swReg = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  });
}

/* ── Tabs ───────────────────────────────────────────────────────────── */
const views = document.querySelectorAll('.view');
const tabs = document.querySelectorAll('.tabs button');

function show(name) {
  views.forEach(v => { v.hidden = v.dataset.view !== name; });
  tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  if (name === 'check') refreshChecks();
}
tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));

/* ── Tonight (mock) ─────────────────────────────────────────────────────
   M0 proves tap targets and legibility in a real dark room. Events are held
   in memory only and deliberately discarded on reload — the banner says so,
   so a logged night is never silently lost to a missing store. */
const LABEL = {
  selfToilet: 'asked to pee',
  lift: 'lifted to potty',
  drink: 'water',
  wake: 'woke up',
  wet: 'WET BED',
};

const mock = [];
const lastText = document.getElementById('last-text');
const undoBtn = document.getElementById('undo');

const hhmm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function renderLast() {
  const e = mock[mock.length - 1];
  lastText.textContent = e
    ? `${hhmm(e.t)}  ${LABEL[e.type]}`
    : 'Nothing logged yet';
  undoBtn.hidden = !e;
  document.getElementById('summary').textContent = mock.length
    ? `${mock.length} event${mock.length > 1 ? 's' : ''} this session (not saved)`
    : 'No night open';
}

document.querySelectorAll('.ev').forEach(btn => {
  btn.addEventListener('click', () => {
    mock.push({ type: btn.dataset.ev, t: new Date() });
    // Visual confirmation: iOS Safari exposes no Vibration API, so a buzz
    // would silently do nothing on the target device.
    btn.classList.add('hit');
    setTimeout(() => btn.classList.remove('hit'), 120);
    renderLast();
  });
});

undoBtn.addEventListener('click', () => { mock.pop(); renderLast(); });

/* ── Install check ──────────────────────────────────────────────────── */
async function refreshChecks() {
  renderChecks(document.getElementById('checks'), await runChecks(VERSION));
}

document.getElementById('recheck').addEventListener('click', refreshChecks);

document.getElementById('persist').addEventListener('click', async () => {
  if (navigator.storage?.persist) await navigator.storage.persist();
  refreshChecks();
});

document.getElementById('update').addEventListener('click', async () => {
  await swReg?.update();
  location.reload();
});

/* ── Boot ───────────────────────────────────────────────────────────── */
document.getElementById('ver').textContent = VERSION;
renderLast();
show('tonight');
