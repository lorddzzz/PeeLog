// PeeLog M1 — boot, hash router, tab bar. Screens own their own DOM; this
// file only decides which one is mounted and holds the single store.

import { runChecks, renderChecks, runSelfTests } from './selftest.js';
import { createStore } from './store.js';
import { exportFileName } from './model.js';
import { linkRow, paint, title } from './ui.js';
import { render as renderTonight, renderEvent } from './tonight.js';
import { renderDay, renderEvening, renderMorning } from './cards.js';

export const VERSION = '0.2.0-m1';

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

/* ── Store ──────────────────────────────────────────────────────────────── */
const store = createStore();

// A document we could not read is the one thing the parent must know about
// before logging on top of it; the copy is already parked under :corrupt.
const banner = document.getElementById('banner');
if (store.loadIssue) {
  banner.textContent = store.loadIssue === 'newer'
    ? 'This phone has a log from a newer version of PeeLog. It was kept, not opened.'
    : 'The saved log could not be read. A copy was kept; tonight starts a new one.';
  banner.hidden = false;
}

// Storage the OS may evict is the standing risk (DESIGN.md §9). Ask once, on a
// device that has nothing recorded yet — Safari decides silently, so there is
// nothing to gate behind a tap, and an already-granted grant is never re-asked.
async function askToPersist() {
  const doc = store.get();
  if (doc.nights.length || doc.activeNightId) return;
  if (!navigator.storage?.persist) return;
  try {
    if (await navigator.storage.persisted?.()) return;
    await navigator.storage.persist();
  } catch { /* not supported here; the Check tab reports the real state */ }
}
askToPersist();

const applyArt = doc => document.body.classList.toggle('no-art', doc.settings?.art === false);
applyArt(store.get());
store.subscribe(applyArt);

/* ── Screens still to come ──────────────────────────────────────────────── */

function renderHistory(el) {
  paint(el, [
    title({ overline: 'History', name: 'Nights', lead: 'History arrives in M3.' }),
    linkRow({ label: 'Back to Tonight', href: '#/tonight' }),
  ]);
}

/* ── Install check ──────────────────────────────────────────────────────
   Its markup stays in index.html and is moved in and out of the router's
   container, so its buttons keep their listeners across navigation. */
const checkSection = document.getElementById('view-check');
checkSection.remove();
checkSection.hidden = false;

async function refreshChecks() {
  // Detached from the document between visits, so the rows are looked up
  // inside the section rather than by id.
  renderChecks(checkSection.querySelector('#checks'), [...await runChecks(VERSION), ...runSelfTests()]);
}

function renderCheck(el) {
  el.replaceChildren(checkSection);
  refreshChecks();
}

checkSection.querySelector('#recheck').addEventListener('click', refreshChecks);

checkSection.querySelector('#persist').addEventListener('click', async () => {
  if (navigator.storage?.persist) await navigator.storage.persist();
  refreshChecks();
});

checkSection.querySelector('#update').addEventListener('click', async () => {
  await swReg?.update();
  location.reload();
});

// The escape hatch (IMPLEMENTATION.md §4, commit 1e): a bare JSON download,
// no share sheet, no date range. Whether a blob: download has anywhere to go
// in iOS standalone mode is unverified — see AGENTS.md "Done means verified".
checkSection.querySelector('#export-json').addEventListener('click', () => {
  const name = exportFileName(new Date());
  const blob = new Blob([JSON.stringify(store.get(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const status = checkSection.querySelector('#export-status');
  status.textContent = `Exported ${name}`;
  status.hidden = false;
});

/* ── Router ─────────────────────────────────────────────────────────────
   Hash routes, so the phone's back gesture works and a committed field
   survives it (handoff rule 7). Adding a screen is one import and one row. */

const routes = [
  ['#/tonight', renderTonight],
  ['#/event/:id', renderEvent],
  ['#/evening/:nightId', renderEvening],
  ['#/morning/:nightId', renderMorning],
  ['#/day/:nightId', renderDay],
  ['#/history', renderHistory],
  ['#/check', renderCheck],
];

// Which tab owns a route. Detail screens stay under the tab they came from.
const TAB_OF = {
  tonight: 'tonight', event: 'tonight', morning: 'tonight', evening: 'tonight',
  history: 'history', night: 'history', patterns: 'history', day: 'history',
  check: 'check',
};

const screen = document.getElementById('screen');
const main = document.querySelector('main');
const tabs = [...document.querySelectorAll('.tabs a')];

function match(hash) {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  for (const [pattern, render] of routes) {
    const shape = pattern.replace(/^#/, '').split('/').filter(Boolean);
    if (shape.length !== parts.length) continue;
    const params = {};
    let hit = true;
    for (let i = 0; i < shape.length; i++) {
      if (shape[i].startsWith(':')) params[shape[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (shape[i] !== parts[i]) { hit = false; break; }
    }
    if (hit) return { render, params, tab: TAB_OF[parts[0]] ?? 'tonight' };
  }
  return null;
}

const ctx = {
  store,
  params: {},
  navigate: hash => { location.hash = hash; },
  now: () => new Date(),
};

let cleanup = null;

function route() {
  const hit = match(location.hash || '#/tonight');
  if (!hit) {
    // An unknown or stale hash is not worth a dead screen at 3am.
    history.replaceState(null, '', '#/tonight');
    route();
    return;
  }

  if (cleanup) cleanup();
  cleanup = null;
  screen.replaceChildren();

  ctx.params = hit.params;
  cleanup = hit.render(screen, ctx) ?? null;

  for (const tab of tabs) {
    if (tab.dataset.tab === hit.tab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  main.scrollTop = 0;
}

window.addEventListener('hashchange', route);

/* ── Boot ───────────────────────────────────────────────────────────────── */
document.getElementById('ver').textContent = VERSION;

// A cold launch always opens Tonight, whatever the last visit was (handoff
// rule 8). replaceState, so the back gesture leaves the app instead of
// bouncing between the restored hash and this one.
history.replaceState(null, '', '#/tonight');
route();
