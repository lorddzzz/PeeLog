// PeeLog — boot, hash router, tab bar. Screens own their own DOM; this file
// only decides which one is mounted and holds the single store.

import { createStore } from './store.js';
import { render as renderTonight, renderEvent } from './tonight.js';
import { renderDay, renderEvening, renderMorning } from './cards.js';
import {
  render as renderHistory, renderBackfill, renderEventEdit, renderNight,
} from './history.js';
import { render as renderPatterns } from './patterns.js';
import {
  render as renderRoutines, renderDetail as renderRoutine, renderNew as renderRoutineNew,
} from './routines.js';
import {
  onRouteChange as restoreRouteChange, renderBackup, renderExport, renderRestore,
} from './backup.js';
import {
  render as renderMore, renderAppearance, renderInstall, renderPrivacy, renderWelcome,
} from './more.js';
import { render as renderSummary } from './summary.js';

export const VERSION = '0.3.0-m5';

/* ── Service worker ─────────────────────────────────────────────────────
   Registered with a relative path so the scope follows the deploy
   directory. GitHub Pages serves project sites from /<repo>/, so nothing
   here may use a root-absolute path. */
let swReg = null;
let updateReady = false;

if ('serviceWorker' in navigator) {
  // A page that was already controlled and then gets a new controller is
  // running older code than the cache now holds: sw.js calls skipWaiting, so
  // there is rarely a `waiting` worker to look at. More → Install says so
  // without reloading anything under a half-finished edit (S01).
  const controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) updateReady = true;
  });
  window.addEventListener('load', async () => {
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
      if (swReg.waiting && controlled) updateReady = true;
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  });
}

const sw = {
  update: () => swReg?.update(),
  updateReady: () => updateReady || !!swReg?.waiting,
};

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
  ['#/history/add', renderBackfill],
  ['#/night/:nightId', renderNight],
  ['#/night/:nightId/event/:eventId', renderEventEdit],
  ['#/patterns', renderPatterns],
  ['#/routines', renderRoutines],
  ['#/routines/new', renderRoutineNew],
  ['#/routines/:id', renderRoutine],
  ['#/more', renderMore],
  ['#/more/backup', renderBackup],
  ['#/more/restore', renderRestore],
  ['#/more/export', renderExport],
  ['#/more/appearance', renderAppearance],
  ['#/more/install', renderInstall],
  ['#/more/privacy', renderPrivacy],
  ['#/summary', renderSummary],
  ['#/welcome', renderWelcome],
  // The Check tab's own hash, kept so a bookmark from before M5 still lands
  // where its rows moved to.
  ['#/check', renderInstall],
];

// Which tab owns a route. Detail screens stay under the tab they came from.
const TAB_OF = {
  tonight: 'tonight', event: 'tonight', morning: 'tonight', evening: 'tonight',
  history: 'history', night: 'history', patterns: 'history', day: 'history',
  routines: 'history',
  more: 'more', summary: 'more', check: 'more', welcome: 'tonight',
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

/* ── Back ───────────────────────────────────────────────────────────────
   One back control in the header, on every screen that has somewhere to go.
   It returns to the screen this session came from, which is what the
   phone's own back gesture does, so the two never disagree; on a cold deep
   link there is no trail, and the route's parent stands in. A save, delete
   or cancel navigates with `replace`, so backing out of a night never lands
   on the edit form it just left. */

const trail = [];      // hashes visited this session, oldest first
let replacing = false; // the next route() rewrites the top of the trail

function parentOf(hash) {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  const [head, id] = parts;
  switch (head) {
    case 'event': return '#/tonight';
    case 'evening': case 'morning': case 'day': return `#/night/${id}`;
    case 'night': return parts.length > 2 ? `#/night/${id}` : '#/history';
    case 'history': return parts.length > 1 ? '#/history' : null;
    case 'routines': return parts.length > 1 ? '#/routines' : null;
    case 'more': return parts.length > 1 ? '#/more' : null;
    case 'summary': return '#/more/export';
    case 'check': return '#/more';
    // tonight, history, patterns, more, welcome: a tab, or a section of one.
    default: return null;
  }
}

function track(hash) {
  const last = trail[trail.length - 1];
  if (trail.length > 1 && trail[trail.length - 2] === hash) trail.pop();
  else if (replacing && trail.length) trail[trail.length - 1] = hash;
  else if (last !== hash) trail.push(hash);
  replacing = false;
}

const backButton = document.getElementById('back');

function goBack() {
  const hash = location.hash || '#/tonight';
  if (trail.length > 1 && trail[trail.length - 1] === hash) history.back();
  else ctx.navigate(parentOf(hash) ?? '#/tonight', { replace: true });
}
backButton.addEventListener('click', goBack);

const ctx = {
  store,
  params: {},
  navigate: (hash, { replace = false } = {}) => {
    if (!replace) { location.hash = hash; return; }
    // A save that returns to the screen the draft was opened from is a step
    // back, not a new entry: replacing would leave that screen in the
    // browser history twice, and the next back would land on it again.
    if (trail.length > 1 && trail[trail.length - 2] === hash) { history.back(); return; }
    replacing = true;
    history.replaceState(null, '', hash);
    route();
  },
  back: goBack,
  now: () => new Date(),
  // The build and the service worker, for More → Install & offline. Passed
  // in rather than imported, so no screen has to import app.js back.
  app: { version: VERSION, sw },
};

let cleanup = null;

function route() {
  const hash = location.hash || '#/tonight';
  const hit = match(hash);
  if (!hit) {
    // An unknown or stale hash is not worth a dead screen at 3am.
    history.replaceState(null, '', '#/tonight');
    route();
    return;
  }

  // A half-finished restore is not a place to come back to days later, so the
  // screen that owns that draft is told where we went (B05 keeps only the trip
  // to Backup and back).
  restoreRouteChange(hash);

  if (cleanup) cleanup();
  cleanup = null;
  screen.replaceChildren();

  track(hash);
  backButton.hidden = parentOf(hash) === null;

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
// rule 8) — except the very first one on a phone with nothing recorded, which
// gets Welcome once. replaceState, so the back gesture leaves the app instead
// of bouncing between the restored hash and this one.
const first = store.get();
const firstRun = !first.nights.length && first.settings?.welcomed !== true;
history.replaceState(null, '', firstRun ? '#/welcome' : '#/tonight');
route();
