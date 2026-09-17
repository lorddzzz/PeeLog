// Diagnostics for the install check, and the closest thing this app has to a
// test suite. Every row here is something the app depends on, phrased so it
// can be read on the phone at a glance.

import { createStore, STORE_KEY } from './store.js';
import {
  activeNightFor, addDrink, backfillTarget, clone, composeIso, dateForNightTime,
  dayDateFor, dayIsUnanswered, deleteNight, emptyDoc, ensureNight, eventCounts,
  eveningSummaryFor, eventSummary, exportFileName, findNight, firstWetTime,
  insertEvent, isReviewed, isUntouchedNight, latestEvent, migrate,
  monthNightsWithGaps, moveEventTo, newDrink, newEvent, newNight, nightIdFor,
  nightIdForIso, nightStatus, openNight, outcomeConflict, parseIso,
  pendingReviewFor, prevNightId, removeDrink, removeEvent, restoreNight,
  retypeEvent, setNoDrinks, stepValue, suggestedEveningTimes, toggleSleepSign,
  toIso, validateDoc,
  applyRestore, assignExperiment, csvEscape, csvRows, csvText, daysSince,
  endExperiment, newExperiment, readBackup, restorePlan,
} from './model.js';
import { metricsSelfTests } from './selftest-metrics.js';
import { h, paint } from './ui.js';
import { summaryData } from './summary.js';

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

/* ── Self-tests ─────────────────────────────────────────────────────────
   Pure model and store assertions, run against a Map-backed storage. They
   must never read or write the real document, so the live key is compared
   before and after as the last row. */

const TEST_KEY = 'peelog:test';

function fakeStorage(seed) {
  const m = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const quotaError = () => {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
};

export function runSelfTests() {
  const rows = [];
  let failed = 0;

  let liveBefore = null;
  try { liveBefore = localStorage.getItem(STORE_KEY); } catch { liveBefore = null; }

  const t = (name, fn) => {
    try {
      rows.push(ok(name, fn() || 'Passed'));
    } catch (err) {
      failed++;
      rows.push(bad(name, err.message || String(err)));
    }
  };

  t('Store round-trip', () => {
    const s = fakeStorage();
    const store = createStore(s, TEST_KEY);
    const r = store.update(d => {
      const night = openNight(d, '2026-09-13');
      const ev = newEvent('wet', '2026-09-14T02:12:00+02:00');
      ev.id = 'e-test01';
      insertEvent(night, ev);
    });
    assert(r.ok, 'update did not report success');

    const reloaded = createStore(s, TEST_KEY).get();
    assert(reloaded.activeNightId === '2026-09-13', 'activeNightId did not survive');
    const night = findNight(reloaded, '2026-09-13');
    assert(night && night.events.length === 1, 'event did not survive');
    assert(night.events[0].id === 'e-test01', 'event id changed');
    assert(night.events[0].t === '2026-09-14T02:12:00+02:00', 'stored offset changed');
    assert(night.events[0].amount === null, 'unanswered detail is not null');
    return 'Saved, reloaded, event and offset intact';
  });

  t('Quota failure keeps the document', () => {
    const s = fakeStorage();
    const store = createStore(s, TEST_KEY);
    store.update(d => openNight(d, '2026-09-13'));
    const before = JSON.stringify(store.get());
    const written = s.getItem(TEST_KEY);

    s.setItem = () => { throw quotaError(); };
    const r = store.update(d => {
      insertEvent(findNight(d, '2026-09-13'), newEvent('wet', '2026-09-14T02:12:00+02:00'));
    });
    assert(r.ok === false, 'a failed write reported success');
    assert(r.error && r.error.name === 'QuotaExceededError', 'the error was not returned');
    assert(JSON.stringify(store.get()) === before, 'the in-memory document changed');
    assert(s.getItem(TEST_KEY) === written, 'storage changed');
    return 'ok:false returned, document and storage unchanged';
  });

  t('Update fn throwing is contained', () => {
    const s = fakeStorage();
    const store = createStore(s, TEST_KEY);
    const before = JSON.stringify(store.get());
    const r = store.update(() => { throw new Error('boom'); });
    assert(r.ok === false, 'a throwing update reported success');
    assert(JSON.stringify(store.get()) === before, 'the document changed');
    return 'ok:false returned, document unchanged';
  });

  t('Night boundary at 15:00', () => {
    assert(nightIdFor(new Date(2026, 8, 13, 14, 59)) === '2026-09-12', '14:59 must still be the previous night');
    assert(nightIdFor(new Date(2026, 8, 13, 15, 0)) === '2026-09-13', '15:00 must open the new night');
    assert(nightIdFor(new Date(2026, 8, 14, 0, 30)) === '2026-09-13', '00:30 must stay on the evening date');
    return '14:59 → 09-12 · 15:00 → 09-13 · 00:30 → 09-13';
  });

  t('Night boundary across month, year, leap day', () => {
    assert(nightIdFor(new Date(2026, 9, 1, 2, 0)) === '2026-09-30', 'month boundary');
    assert(nightIdFor(new Date(2027, 0, 1, 2, 0)) === '2026-12-31', 'year boundary');
    assert(nightIdFor(new Date(2028, 2, 1, 3, 0)) === '2028-02-29', 'leap day');
    return '01 Oct 02:00 → 09-30 · 01 Jan 02:00 → 12-31 · 01 Mar 03:00 → 02-29';
  });

  t('Night boundary across a DST change', () => {
    assert(nightIdFor(new Date(2026, 2, 29, 3, 30)) === '2026-03-28', 'spring forward moved the night');
    assert(nightIdFor(new Date(2026, 9, 25, 2, 30)) === '2026-10-24', 'autumn back moved the night');
    return '29 Mar 03:30 → 03-28 · 25 Oct 02:30 → 10-24';
  });

  t('Stored offset is read, not reinterpreted', () => {
    const a = parseIso('2026-09-14T02:12:00+02:00');
    assert(a.date === '2026-09-14' && a.time === '02:12', `wall clock changed: ${a.date} ${a.time}`);
    assert(a.ms === Date.UTC(2026, 8, 14, 0, 12), 'instant wrong for +02:00');
    const b = parseIso('2026-09-13T23:45:00-05:00');
    assert(b.date === '2026-09-13' && b.time === '23:45', `wall clock changed: ${b.date} ${b.time}`);
    assert(b.ms === Date.UTC(2026, 8, 14, 4, 45), 'instant wrong for -05:00');
    assert(parseIso('2026-09-14T02:12') === null, 'a bare local time was accepted');
    return '+02:00 and -05:00 keep their wall clock on any device zone';
  });

  t('toIso round trip', () => {
    const d = new Date(2026, 8, 14, 2, 12, 0, 0);
    const iso = toIso(d);
    assert(/^2026-09-14T02:12:00[+-]\d{2}:\d{2}$/.test(iso), `unexpected format: ${iso}`);
    const p = parseIso(iso);
    assert(p.date === '2026-09-14' && p.time === '02:12', 'round trip lost the wall clock');
    assert(p.ms === d.getTime(), 'round trip lost the instant');
    assert(composeIso('2026-09-14', '02:12') === iso, 'composeIso disagrees with toIso');
    return iso;
  });

  t('composeIso refuses a wall clock that does not exist', () => {
    assert(composeIso('2026-09-13', '99:99') === null, '99:99 was accepted (Date rolls it four days on)');
    assert(composeIso('2026-09-13', '24:00') === null, '24:00 was accepted');
    assert(composeIso('2026-09-13', '12:60') === null, 'a 60th minute was accepted');
    assert(composeIso('2026-02-30', '10:00') === null, 'a date that does not exist was accepted');
    assert(composeIso('2026-09-13', '') === null, 'an empty time was accepted');

    // Whatever zone this device is in, anything returned must read back as
    // exactly what was asked for.
    for (const date of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01']) {
      for (const time of ['00:30', '01:30', '02:30', '03:30', '23:30']) {
        const iso = composeIso(date, time);
        if (iso === null) continue;
        const p = parseIso(iso);
        assert(p.date === date && p.time === time, `${date} ${time} became ${iso}`);
      }
    }
    // And on a device that does skip an hour, the skipped time is refused
    // rather than silently recorded as the hour after it.
    if (new Date(2026, 2, 29, 2, 30).getHours() !== 2) {
      assert(composeIso('2026-03-29', '02:30') === null, 'a wall clock the DST jump skips was accepted');
    }
    return 'Out-of-range and DST-skipped wall clocks return null, never the next valid instant';
  });

  t('A UTC Z timestamp is refused, and migrated to an offset', () => {
    assert(parseIso('2026-09-13T14:00:00Z') === null, 'a Z timestamp was accepted as an instant');
    const stored = {
      version: 1,
      activeNightId: null,
      experiments: [],
      settings: {},
      nights: [{
        id: '2026-09-13',
        evening: { dinnerAt: '2026-09-13T18:30:00Z', drinks: [{ id: 'd-1', at: '2026-09-13T19:00:00Z', size: 'cup' }] },
        events: [{ id: 'e-z', type: 'wet', t: '2026-09-14T02:12:00Z' }],
        morning: { wakeAt: '2026-09-14T06:30:00Z' },
      }],
    };
    const m = migrate(stored);
    assert(m.ok, 'the document was refused instead of migrated');
    const night = m.doc.nights[0];
    assert(night.events[0].t === '2026-09-14T02:12:00+00:00', `event: ${night.events[0].t}`);
    assert(night.evening.dinnerAt === '2026-09-13T18:30:00+00:00', `dinner: ${night.evening.dinnerAt}`);
    assert(night.evening.drinks[0].at === '2026-09-13T19:00:00+00:00', `drink: ${night.evening.drinks[0].at}`);
    assert(night.morning.wakeAt === '2026-09-14T06:30:00+00:00', `wake: ${night.morning.wakeAt}`);
    const check = validateDoc(m.doc);
    assert(check.ok, `the migrated document is still invalid: ${check.errors.join('; ')}`);
    return 'Z refused by parseIso · every stored Z instant rewritten to +00:00';
  });

  t('Events stay in time order', () => {
    const night = newNight('2026-09-13');
    insertEvent(night, newEvent('drink', '2026-09-13T22:00:00+02:00'));
    insertEvent(night, newEvent('wet', '2026-09-14T02:12:00+02:00'));
    // Logged after the wet bed, but it happened before it.
    insertEvent(night, newEvent('lift', '2026-09-13T23:30:00+02:00'));
    const ms = night.events.map(e => parseIso(e.t).ms);
    assert(ms.every((v, i) => i === 0 || ms[i - 1] <= v), `out of order: ${night.events.map(e => e.t)}`);
    assert(night.events.map(e => e.type).join() === 'drink,lift,wet', 'wrong order');
    assert(latestEvent(night).type === 'wet', 'latest is not the newest by time');
    return 'An earlier timestamp inserts in place; latest stays the newest';
  });

  t('Undo removes only the latest event', () => {
    const night = newNight('2026-09-13');
    insertEvent(night, newEvent('drink', '2026-09-13T22:00:00+02:00'));
    insertEvent(night, newEvent('lift', '2026-09-13T23:30:00+02:00'));
    insertEvent(night, newEvent('wet', '2026-09-14T02:12:00+02:00'));
    const target = latestEvent(night);
    const removed = removeEvent(night, target.id);
    assert(removed && removed.id === target.id, 'the latest event was not returned');
    assert(night.events.length === 2, 'wrong number of events left');
    assert(night.events.map(e => e.type).join() === 'drink,lift', 'the wrong events were removed');
    assert(removeEvent(night, 'e-nothing') === null, 'removing an unknown id did something');
    return '3 → 2 events, earlier ones untouched';
  });

  t('A stale night does not absorb tonight', () => {
    const doc = emptyDoc();
    openNight(doc, '2026-09-12');
    const now = new Date(2026, 8, 13, 22, 0);
    let a = activeNightFor(doc, now);
    assert(a.id === '2026-09-13', `events would land in ${a.id}`);
    assert(a.stale === '2026-09-12', 'the unreviewed night was not carried forward');
    findNight(doc, '2026-09-12').morning.outcome = 'dry';
    a = activeNightFor(doc, now);
    assert(a.stale === null, 'a reviewed night is still asking for review');
    openNight(doc, '2026-09-13');
    a = activeNightFor(doc, now);
    assert(a.id === '2026-09-13' && a.stale === null, 'the open night was not kept');
    return 'Tonight moves on, the unreviewed night is carried as a link';
  });

  t('A tap lands in tonight while a stale night waits', () => {
    // The exact sequence Tonight runs on a tap: which night, then open it and
    // insert. The unreviewed night must keep its own events and gain none.
    const doc = emptyDoc();
    const yesterday = openNight(doc, '2026-09-12');
    insertEvent(yesterday, newEvent('wet', '2026-09-13T02:00:00+02:00'));

    const now = new Date(2026, 8, 13, 23, 40);
    const active = activeNightFor(doc, now);
    assert(active.id === '2026-09-13' && active.stale === '2026-09-12', `active ${active.id}, stale ${active.stale}`);

    const night = openNight(doc, active.id);
    insertEvent(night, newEvent('drink', toIso(now)));
    assert(doc.activeNightId === '2026-09-13', 'the new night was not opened');
    assert(findNight(doc, '2026-09-12').events.length === 1, 'the stale night absorbed the new event');
    assert(findNight(doc, '2026-09-13').events.length === 1, 'the event did not land in tonight');
    // activeNightFor has moved on, so the review link comes from the document.
    assert(activeNightFor(doc, now).stale === null, 'activeNightFor still reports the night it left');
    assert(pendingReviewFor(doc, '2026-09-13') === '2026-09-12', 'the review link disappeared after logging');

    findNight(doc, '2026-09-12').morning.outcome = 'wet';
    assert(pendingReviewFor(doc, '2026-09-13') === null, 'a reviewed night still asks for review');
    assert(pendingReviewFor(doc, '2026-09-12') === null, 'a night that was never recorded asks for review');
    return 'Logged into 09-13; 09-12 keeps its event and its review link';
  });

  t('Every event is filed under the night of its own timestamp', () => {
    // The night choice tonight.js makes on a tap, and the invariant it exists
    // for: an event only ever sits in the night its own wall clock falls in.
    const doc = emptyDoc();
    const file = (type, t, now) => {
      const tonightId = nightIdFor(now);
      const id = nightIdForIso(t) ?? tonightId;
      const night = id === tonightId ? openNight(doc, id) : ensureNight(doc, id);
      return insertEvent(night, newEvent(type, t));
    };
    const misfiled = () => doc.nights.flatMap(n =>
      n.events.filter(e => nightIdForIso(e.t) !== n.id).map(e => `${n.id} holds ${e.t}`));

    // A device clock that ran fast left a night open in the future. It must
    // absorb nothing, and it is not a night anyone can review yet.
    doc.activeNightId = '2027-01-01';
    ensureNight(doc, '2027-01-01');
    const evening = new Date(2026, 8, 13, 23, 40);
    const a = activeNightFor(doc, evening);
    assert(a.id === '2026-09-13' && a.stale === null, `future active night: ${JSON.stringify(a)}`);

    file('drink', toIso(evening), evening);
    const past = new Date(2026, 8, 14, 2, 12);
    file('wet', toIso(past), past);
    // A tap that failed at 14:50 and was retried at 15:10 keeps the night it
    // happened in, not the one that opened while the notice was on screen.
    const retried = file('lift', toIso(new Date(2026, 8, 13, 14, 50)), new Date(2026, 8, 13, 15, 10));
    assert(nightIdForIso(retried.t) === '2026-09-12', 'the retry lost its own night');
    assert(findNight(doc, '2026-09-12').events.length === 1, 'the retry did not land in 09-12');
    assert(doc.activeNightId === '2026-09-13', 'a late retry moved the open night backwards');
    assert(findNight(doc, '2026-09-13').events.length === 2, '09-13 lost an event');
    assert(findNight(doc, '2027-01-01').events.length === 0, 'the future night absorbed an event');
    assert(misfiled().length === 0, `misfiled: ${misfiled().join(', ')}`);
    return 'Evening tap, after-midnight tap and a retry across 15:00 each land in their own night';
  });

  t('A night nobody answered anything on is untouched', () => {
    assert(isUntouchedNight(newNight('2026-09-13')), 'a fresh night was not untouched');
    assert(isUntouchedNight(null) === false, 'a missing night read as untouched');
    const touch = fn => {
      const n = newNight('2026-09-13');
      fn(n);
      return isUntouchedNight(n);
    };
    assert(touch(n => insertEvent(n, newEvent('wet', '2026-09-14T02:12:00+02:00'))) === false, 'an event');
    assert(touch(n => { n.diaper = 'none'; }) === false, 'diaper: none is an answer');
    assert(touch(n => { n.experimentId = 'x-1'; }) === false, 'an assigned routine');
    assert(touch(n => { n.morning.outcome = 'dry'; }) === false, 'a recorded outcome');
    assert(touch(n => { n.morning.changes = 0; }) === false, 'an answered 0');
    assert(touch(n => { n.evening.asleepEstimated = true; }) === false, 'an estimated flag');
    assert(touch(n => { n.evening.note = 'late nap'; }) === false, 'a note');
    assert(touch(n => { n.evening.dayContext = ['nap']; }) === false, 'a day context');
    assert(touch(n => addDrink(n.evening, newDrink())) === false, 'a drink row');
    assert(touch(n => { n.day.stool = 'none'; }) === false, "day stool: 'none' is an answer");
    return 'Defaults only; false, 0 and none all count as answered';
  });

  t('Moving an event leaves no phantom night behind', () => {
    const doc = emptyDoc();
    const ev = insertEvent(openNight(doc, '2026-09-13'), newEvent('wet', composeIso('2026-09-14', '02:12')));
    // The sequence tonight.js moveEvent runs: out of one night, into the night
    // the new timestamp belongs to, and the emptied source dropped with it.
    const move = t => {
      const from = doc.nights.find(n => n.events.some(e => e.id === ev.id));
      const to = nightIdForIso(t);
      const entry = removeEvent(from, ev.id);
      entry.t = t;
      insertEvent(to === from.id ? from : ensureNight(doc, to), entry);
      if (to !== from.id && isUntouchedNight(from)) {
        doc.nights.splice(doc.nights.indexOf(from), 1);
        if (doc.activeNightId === from.id) doc.activeNightId = null;
      }
    };
    const filed = () => doc.nights.every(n => n.events.every(e => nightIdForIso(e.t) === n.id));

    move(composeIso('2026-09-13', '02:12'));
    assert(findNight(doc, '2026-09-13') === null, 'the emptied source night was kept');
    assert(doc.activeNightId === null, 'activeNightId still points at a night that was deleted');
    assert(findNight(doc, '2026-09-12').events.length === 1, 'the event did not arrive');
    assert(filed(), 'an event sits in the wrong night after a move');

    // A night with an answer on it stays, even once its last event leaves.
    const reviewed = ensureNight(doc, '2026-09-13');
    reviewed.morning.outcome = 'dry';
    move(composeIso('2026-09-14', '02:12'));
    assert(findNight(doc, '2026-09-12') === null, 'the second emptied night was kept');
    move(composeIso('2026-09-13', '02:12'));
    assert(findNight(doc, '2026-09-13')?.morning.outcome === 'dry', 'a reviewed night was deleted');
    assert(findNight(doc, '2026-09-13').events.length === 0, 'the event did not leave the reviewed night');
    assert(filed(), 'an event sits in the wrong night after a move');
    return 'The empty source night is dropped; a reviewed one is kept';
  });

  t('A typed time belongs to the right calendar date', () => {
    // 02:12 on the night of the 13th is the 14th; 23:40 is still the 13th.
    assert(dateForNightTime('2026-09-13', '23:40') === '2026-09-13', 'an evening time moved date');
    assert(dateForNightTime('2026-09-13', '15:00') === '2026-09-13', '15:00 must stay on the evening date');
    assert(dateForNightTime('2026-09-13', '14:59') === '2026-09-14', '14:59 must be the morning after');
    assert(dateForNightTime('2026-09-13', '02:12') === '2026-09-14', 'an after-midnight time stayed on the evening date');
    assert(dateForNightTime('2026-09-30', '02:12') === '2026-10-01', 'month boundary');
    assert(dateForNightTime('2026-09-13', 'half nine') === null, 'a bad time was accepted');
    // And the inverse, read from the stored offset rather than the device zone.
    assert(nightIdForIso('2026-09-14T02:12:00+02:00') === '2026-09-13', 'after midnight belongs to the evening before');
    assert(nightIdForIso('2026-09-13T23:40:00-05:00') === '2026-09-13', 'an evening stamp moved night');
    assert(nightIdForIso('2026-09-14T14:59:00+02:00') === '2026-09-13', '14:59 must still be the previous night');
    return '23:40 → 09-13 · 02:12 → 09-14 · and back again';
  });

  t('The day block belongs to the day after', () => {
    assert(dayDateFor('2026-09-13') === '2026-09-14', "night 09-13's day must be 09-14");
    assert(prevNightId('2026-09-13') === '2026-09-12', 'previous night wrong');
    // The bowel overlay reads night N−1's day, which is the daytime before N.
    assert(dayDateFor(prevNightId('2026-09-13')) === '2026-09-13', 'the overlay would read the wrong day');
    assert(dayDateFor('2026-12-31') === '2027-01-01', 'year boundary');
    assert(prevNightId('2026-03-01') === '2026-02-28', 'month boundary');
    return "night['2026-09-13'].day describes 2026-09-14";
  });

  t('Migration', () => {
    const newer = migrate({ version: 2, nights: [] });
    assert(newer.ok === false && newer.reason === 'newer', 'a newer document was accepted');
    assert(migrate(null).doc.version === 1, 'a missing document did not become an empty one');
    assert(migrate('garbage').doc.nights.length === 0, 'a non-object did not become an empty one');

    const old = { version: 1, nights: [{ id: '2026-09-13', evening: {}, events: [], morning: { changes: 0 } }] };
    const m = migrate(old);
    assert(m.ok, 'a version 1 document was rejected');
    const night = m.doc.nights[0];
    assert(m.doc.settings.art === true, 'settings were not filled in');
    assert(night.evening.noDrinks === null && night.morning.eventsComplete === null, 'later fields were not filled in');
    assert(night.day && night.day.stool === null, 'the day block was not filled in');
    assert(Array.isArray(night.evening.drinks) && night.evening.drinks.length === 0, 'drinks were not filled in');
    assert(night.morning.changes === 0, 'an answered 0 was overwritten by the default');
    return 'v2 refused · v1 filled in · answered values kept';
  });

  t('Validation refuses a bad restore file', () => {
    const doc = emptyDoc();
    const night = openNight(doc, '2026-09-13');
    insertEvent(night, newEvent('drink', '2026-09-13T22:00:00+02:00'));
    insertEvent(night, newEvent('wet', '2026-09-14T02:12:00+02:00'));
    const good = validateDoc(doc);
    assert(good.ok, `a good document was rejected: ${good.errors.join('; ')}`);

    const bare = clone(doc);
    bare.nights[0].events[0].t = '2026-09-13T22:00';
    assert(!validateDoc(bare).ok, 'a timestamp without an offset was accepted');

    const utc = clone(doc);
    utc.nights[0].events[0].t = '2026-09-13T20:00:00Z';
    assert(!validateDoc(utc).ok, 'a UTC Z timestamp was accepted');

    const swapped = clone(doc);
    swapped.nights[0].events.reverse();
    assert(!validateDoc(swapped).ok, 'out-of-order events were accepted');

    const dupes = clone(doc);
    dupes.nights.push(clone(dupes.nights[0]));
    assert(!validateDoc(dupes).ok, 'duplicate night ids were accepted');

    // One id, two nights: nightForEvent finds only the first, so an edit to
    // the second would land on the wrong entry.
    const sameId = clone(doc);
    const second = clone(sameId.nights[0]);
    second.id = '2026-09-14';
    sameId.nights.push(second);
    assert(!validateDoc(sameId).ok, 'the same event id in two nights was accepted');

    const twice = clone(doc);
    twice.nights[0].events[1].id = twice.nights[0].events[0].id;
    assert(!validateDoc(twice).ok, 'a repeated event id within a night was accepted');

    const drinks = clone(doc);
    drinks.nights[0].evening.drinks = [newDrink(), newDrink()];
    drinks.nights[0].evening.drinks[1].id = drinks.nights[0].evening.drinks[0].id;
    assert(!validateDoc(drinks).ok, 'a repeated drink id within a night was accepted');

    const wrongType = clone(doc);
    wrongType.nights[0].events[0].type = 'nap';
    assert(!validateDoc(wrongType).ok, 'an unknown event type was accepted');
    assert(!validateDoc({ version: 2, nights: [], experiments: [], settings: {}, activeNightId: null }).ok, 'a newer version was accepted');
    return 'Offsets, event order, unique ids and known types all checked';
  });

  t('Last session is kept beside the live document', () => {
    const seeded = JSON.stringify({ version: 1, activeNightId: '2026-09-12', nights: [], experiments: [], settings: {} });
    const s = fakeStorage({ [TEST_KEY]: seeded });
    const store = createStore(s, TEST_KEY);
    assert(s.getItem(`${TEST_KEY}:prev`) === seeded, ':prev copy is missing after boot');
    store.update(d => { d.activeNightId = '2026-09-13'; });
    assert(s.getItem(`${TEST_KEY}:prev`) === seeded, ':prev was overwritten by a later write');
    assert(store.get().settings.art === true, 'missing settings were not filled in on load');
    return `${TEST_KEY}:prev holds the document as loaded`;
  });

  t('An unreadable document is kept, not dropped', () => {
    const s = fakeStorage({ [TEST_KEY]: '{ not json' });
    const store = createStore(s, TEST_KEY);
    assert(store.get().nights.length === 0, 'it did not start from an empty document');
    assert(s.getItem(`${TEST_KEY}:corrupt`) === '{ not json', 'the raw text was discarded');
    assert(store.loadIssue === 'corrupt', 'the failure was not reported');
    return 'Raw text parked under :corrupt, app starts empty';
  });

  t('A newer document is not overwritten silently', () => {
    const raw = JSON.stringify({ version: 2, nights: [] });
    const s = fakeStorage({ [TEST_KEY]: raw });
    const store = createStore(s, TEST_KEY);
    assert(store.loadIssue === 'newer', 'the newer version was not reported');
    assert(s.getItem(`${TEST_KEY}:newer`) === raw, 'the newer document was not preserved');
    return 'Copy kept under :newer before the app starts empty';
  });

  t('Event summary', () => {
    const wet = newEvent('wet', '2026-09-14T02:12:00+02:00');
    assert(eventSummary(wet) === 'Wet bed', eventSummary(wet));
    wet.amount = 'soaked';
    assert(eventSummary(wet) === 'Wet bed · soaked', eventSummary(wet));
    const asked = newEvent('selfToilet', '2026-09-14T02:12:00+02:00');
    asked.madeIt = true;
    assert(eventSummary(asked) === 'She asked to pee · made it', eventSummary(asked));
    const water = newEvent('drink', '2026-09-13T23:00:00+02:00');
    assert(eventSummary(water) === 'Water', eventSummary(water));
    return "'Wet bed · soaked' · 'She asked to pee · made it'";
  });

  t('A Dry outcome conflicts with a recorded wet event', () => {
    const night = newNight('2026-09-13');
    assert(outcomeConflict(night, 'dry') === null, 'no wet events still conflicted');
    assert(isReviewed(night) === false, 'an unset outcome was reviewed');

    const wet = newEvent('wet', '2026-09-14T02:12:00+02:00');
    insertEvent(night, wet);
    const conflict = outcomeConflict(night, 'dry');
    assert(conflict && conflict.id === wet.id, 'the wet event was not returned as the conflict');
    assert(outcomeConflict(night, 'wet') === null, 'Wet conflicted with its own wet event');

    night.morning.outcome = 'dry';
    assert(isReviewed(night), 'a dry outcome was not reviewed');
    return 'dry + wet event conflicts; wet and no-events never do';
  });

  t('Export filename', () => {
    const name = exportFileName(new Date(2026, 8, 13, 23, 59));
    assert(name === 'peelog-2026-09-13.peelog.json', `unexpected name: ${name}`);
    assert(name.endsWith('.peelog.json'), 'the gitignored suffix is missing');
    return name;
  });

  t('Suggested evening times are computed, not written', () => {
    const doc = emptyDoc();
    const prev = openNight(doc, '2026-09-12');
    prev.evening.dinnerAt = composeIso('2026-09-12', '18:30');
    prev.evening.lightsOutAt = composeIso('2026-09-12', '20:15');
    prev.evening.asleepAt = composeIso('2026-09-13', '00:10'); // after midnight
    const before = JSON.stringify(doc);

    const suggested = suggestedEveningTimes(doc, '2026-09-13');
    assert(JSON.stringify(doc) === before, 'computing suggestions wrote to the document');
    assert(suggested.dinnerAt === composeIso('2026-09-13', '18:30'), `dinner not remapped onto the new night: ${suggested.dinnerAt}`);
    assert(suggested.lightsOutAt === composeIso('2026-09-13', '20:15'), `lights-out not remapped: ${suggested.lightsOutAt}`);
    assert(suggested.asleepAt === composeIso('2026-09-14', '00:10'), `an after-midnight suggestion kept the wrong date: ${suggested.asleepAt}`);

    const none = suggestedEveningTimes(emptyDoc(), '2026-09-13');
    assert(none.dinnerAt === null && none.lightsOutAt === null && none.asleepAt === null, 'no previous night should suggest nothing');
    return 'Remapped onto the new night; a document with no previous night suggests nothing';
  });

  t('noDrinks and a logged drink are mutually exclusive', () => {
    const evening = newNight('2026-09-13').evening;
    assert(evening.noDrinks === null && evening.drinks.length === 0, 'a fresh night started answered');

    setNoDrinks(evening, true);
    assert(evening.noDrinks === true && evening.drinks.length === 0, 'confirming none did not stick');

    const drink = newDrink(composeIso('2026-09-13', '19:10'), 'cup');
    addDrink(evening, drink);
    assert(evening.noDrinks === null, 'logging a drink did not clear the earlier confirmed none');
    assert(evening.drinks.length === 1 && evening.drinks[0].id === drink.id, 'the drink was not recorded');

    removeDrink(evening, drink.id);
    assert(evening.drinks.length === 0, 'removeDrink left the row in place');

    addDrink(evening, newDrink());
    setNoDrinks(evening, true);
    assert(evening.drinks.length === 0, 'confirming none afterwards did not clear the stale row');

    setNoDrinks(evening, false);
    assert(evening.noDrinks === null, 'clearing the confirmation did not return to unknown');
    return 'addDrink clears noDrinks; setNoDrinks(true) clears drinks either order';
  });

  t('Sleep signs: none excludes every other sign', () => {
    assert(JSON.stringify(toggleSleepSign(null, 'none')) === '["none"]', 'selecting none from unknown failed');
    assert(JSON.stringify(toggleSleepSign(['none'], 'snoring')) === '["snoring"]', 'adding a real sign did not drop none');
    assert(toggleSleepSign(['snoring'], 'snoring') === null, 'removing the last sign did not return to unknown');
    assert(JSON.stringify(toggleSleepSign(['snoring'], 'restless')) === '["snoring","restless"]', 'a second sign was not added');
    assert(toggleSleepSign(['none'], 'none') === null, 'tapping the selected none chip did not clear it');
    return "null → ['none'] → ['snoring'] → null; a second sign adds alongside the first";
  });

  t('Stepper value never drops below its minimum', () => {
    assert(stepValue(null, 0, 1) === 0, 'the first tap did not answer the minimum');
    assert(stepValue(undefined, 0, 1) === 0, 'an unset value was not treated the same as null');
    assert(stepValue(0, 0, -1) === 0, 'stepping down from the minimum went negative');
    assert(stepValue(2, 0, -1) === 1, 'a normal decrement was wrong');
    return '0 is reachable without passing through 1; never below min';
  });

  t('eveningSummaryFor and dayIsUnanswered', () => {
    const night = newNight('2026-09-13');
    assert(eveningSummaryFor(night.evening) === null, 'an untouched evening summarised to something');
    assert(dayIsUnanswered(night.day), 'a fresh day block was not unanswered');

    night.evening.asleepAt = composeIso('2026-09-13', '20:45');
    addDrink(night.evening, newDrink());
    assert(eveningSummaryFor(night.evening) === 'Asleep 20:45 · 1 drink', `unexpected summary: ${eveningSummaryFor(night.evening)}`);

    night.day.stool = 'none';
    assert(!dayIsUnanswered(night.day), 'an answered false-y value (stool: none) read as unanswered');
    return "'Asleep 20:45 · 1 drink' · stool:'none' counts as answered";
  });

  /* ── History (M3) ───────────────────────────────────────────────────── */

  t('An edited time moves the entry across the 15:00 boundary', () => {
    const doc = emptyDoc();
    const night = ensureNight(doc, '2026-09-13');
    const ev = newEvent('wet', '2026-09-14T02:00:00+02:00');
    ev.id = 'e-move';
    insertEvent(night, ev);

    const moved = moveEventTo(doc, 'e-move', '2026-09-14T16:00:00+02:00');
    assert(moved.fromId === '2026-09-13' && moved.toId === '2026-09-14', `moved ${JSON.stringify(moved)}`);
    assert(!findNight(doc, '2026-09-13'), 'the night the entry left held nothing else and should be gone');
    const to = findNight(doc, '2026-09-14');
    assert(to && to.events.length === 1 && to.events[0].id === 'e-move', 'the entry did not land on the new night');
    assert(to.events[0].t === '2026-09-14T16:00:00+02:00', 'the timestamp was not applied');

    // The same move, from a night that has something else recorded on it.
    const kept = emptyDoc();
    const source = ensureNight(kept, '2026-09-13');
    source.morning.outcome = 'dry';
    const ev2 = newEvent('drink', '2026-09-14T02:00:00+02:00');
    ev2.id = 'e-keep';
    insertEvent(source, ev2);
    moveEventTo(kept, 'e-keep', '2026-09-14T16:00:00+02:00');
    assert(findNight(kept, '2026-09-13'), 'a night with a recorded outcome was deleted by a move');
    assert(findNight(kept, '2026-09-13').events.length === 0, 'the entry was left behind');
    assert(findNight(kept, '2026-09-14').events.length === 1, 'the entry did not arrive');
    return '02:00 → 16:00 reassigns 09-13 → 09-14; an untouched source is removed, a recorded one kept';
  });

  t('A moved entry keeps its night in time order', () => {
    const doc = emptyDoc();
    const night = ensureNight(doc, '2026-09-13');
    for (const [id, time] of [['e-a', '2026-09-13T23:00:00+02:00'], ['e-b', '2026-09-14T01:00:00+02:00'],
      ['e-c', '2026-09-14T05:00:00+02:00']]) {
      const ev = newEvent('drink', time);
      ev.id = id;
      insertEvent(night, ev);
    }
    moveEventTo(doc, 'e-a', '2026-09-14T03:00:00+02:00');
    assert(findNight(doc, '2026-09-13').events.map(e => e.id).join(',') === 'e-b,e-a,e-c',
      `out of order: ${findNight(doc, '2026-09-13').events.map(e => e.id)}`);
    return 'A move inside the same night re-sorts by time';
  });

  t('Changing an entry\'s type clears only that entry', () => {
    const wet = newEvent('wet', '2026-09-14T02:12:00+02:00');
    wet.id = 'e-typed';
    wet.amount = 'soaked';
    wet.noticed = 'self';
    wet.changed = ['sheets'];
    const other = newEvent('wet', '2026-09-14T03:00:00+02:00');
    other.amount = 'damp';

    const next = retypeEvent(wet, 'drink');
    assert(next.id === wet.id, 'the entry lost its identity');
    assert(next.t === wet.t, 'the timestamp changed');
    assert(next.type === 'drink', 'the type did not change');
    assert(next.size === null, 'the new type started answered');
    assert(!('amount' in next) && !('noticed' in next) && !('changed' in next), `old fields survived: ${Object.keys(next)}`);
    assert(other.amount === 'damp', 'another entry was changed');
    assert(wet.amount === 'soaked', 'the original was mutated instead of replaced');
    return 'id and t kept · every wet-bed detail dropped · other entries untouched';
  });

  t('History rows fill calendar gaps without inventing nights', () => {
    const doc = emptyDoc();
    const dry = ensureNight(doc, '2026-09-11');
    dry.morning.outcome = 'dry';
    const wet = ensureNight(doc, '2026-09-13');
    insertEvent(wet, newEvent('wet', '2026-09-14T02:12:00+02:00'));

    // 15 September, 10:00 — tonight's night is the 14th and is still open.
    const rows = monthNightsWithGaps(doc, '2026-09', new Date(2026, 8, 15, 10, 0));
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    assert(rows[0].id === '2026-09-13', `newest first expected 09-13, got ${rows[0].id}`);
    assert(!byId['2026-09-14'], "tonight's unfinished night was listed as a gap");
    assert(!byId['2026-09-16'], 'a future date was listed');
    assert(byId['2026-09-12'].kind === 'no-record' && byId['2026-09-12'].status === 'no-record',
      'a date with no record did not read as one');
    assert(byId['2026-09-11'].status === 'dry', 'a recorded dry night lost its outcome');
    assert(byId['2026-09-13'].status === 'wet-review-due', 'a wet entry without a review read as a confirmed outcome');
    assert(rows.filter(r => r.kind === 'night').length === 2, 'a gap was counted as a night');
    return '09-13 … 09-01, no 09-14 (tonight) and no future dates; gaps read no-record';
  });

  t('Night status tells the four states apart', () => {
    const blank = newNight('2026-09-13');
    assert(nightStatus(blank) === 'review-due', 'an untouched night was not review due');
    assert(firstWetTime(blank) === null, 'an empty night reported a wetting');

    const wet = newNight('2026-09-13');
    insertEvent(wet, newEvent('wet', '2026-09-14T02:12:00+02:00'));
    insertEvent(wet, newEvent('lift', '2026-09-13T23:00:00+02:00'));
    assert(nightStatus(wet) === 'wet-review-due', 'a wet entry without a review was not flagged for review');
    assert(firstWetTime(wet) === '2026-09-14T02:12:00+02:00', `first wetting: ${firstWetTime(wet)}`);
    assert(eventCounts(wet).wet === 1 && eventCounts(wet).lift === 1 && eventCounts(wet).drink === 0,
      `counts: ${JSON.stringify(eventCounts(wet))}`);

    wet.morning.outcome = 'wet';
    assert(nightStatus(wet) === 'wet', 'a reviewed wet night was not wet');
    const dry = newNight('2026-09-12');
    dry.morning.outcome = 'dry';
    assert(nightStatus(dry) === 'dry', 'a reviewed dry night was not dry');
    return 'review-due · wet-review-due · wet · dry';
  });

  t('A deleted night comes back where it was', () => {
    const doc = emptyDoc();
    for (const id of ['2026-09-11', '2026-09-12', '2026-09-13']) ensureNight(doc, id);
    const middle = findNight(doc, '2026-09-12');
    insertEvent(middle, newEvent('wet', '2026-09-13T02:12:00+02:00'));
    middle.morning.outcome = 'wet';
    doc.activeNightId = '2026-09-12';
    const before = JSON.stringify(doc);

    const removed = deleteNight(doc, '2026-09-12');
    assert(removed && removed.index === 1, `unexpected index: ${removed && removed.index}`);
    assert(removed.wasActive === true, 'the open night was not reported as open');
    assert(doc.activeNightId === null, 'activeNightId still points at a night that is gone');
    assert(doc.nights.map(n => n.id).join(',') === '2026-09-11,2026-09-13', 'the wrong night was removed');

    restoreNight(doc, removed.night, removed.wasActive);
    assert(JSON.stringify(doc) === before, 'the restored document differs from the original');

    // A night recorded again in the meantime is never overwritten by an Undo.
    const again = deleteNight(doc, '2026-09-12');
    ensureNight(doc, '2026-09-12');
    assert(restoreNight(doc, again.night, again.wasActive) === null, 'restore overwrote a night recorded since');
    assert(findNight(doc, '2026-09-12').events.length === 0, 'the night recorded since was replaced');
    return 'Same index, same document · a night recorded since is left alone';
  });

  t('Backfilling a recorded date opens it instead of duplicating it', () => {
    const doc = emptyDoc();
    ensureNight(doc, '2026-09-09');
    const now = new Date(2026, 8, 13, 20, 0); // tonight is 2026-09-13

    const existing = backfillTarget(doc, '2026-09-09', now);
    assert(existing.exists === true && existing.id === '2026-09-09', 'an existing date was not recognised');

    const fresh = backfillTarget(doc, '2026-09-10', now);
    assert(fresh.exists === false && fresh.valid === true, 'a free date was refused');

    assert(backfillTarget(doc, '2026-09-13', now).future === false, 'tonight was treated as the future');
    assert(backfillTarget(doc, '2026-09-14', now).future === true, "tomorrow's evening was accepted");
    assert(backfillTarget(doc, 'not-a-date', now).valid === false, 'a nonsense date passed validation');

    // Creating the same date twice can only ever produce one record.
    ensureNight(doc, '2026-09-09');
    assert(doc.nights.filter(n => n.id === '2026-09-09').length === 1, 'a duplicate night was created');
    return 'Existing date → exists:true · tomorrow → future:true · ensureNight never duplicates';
  });

  /* ── M5: export, restore, routines ──────────────────────────────────
     The three things that can lose data: a CSV that misquotes a note, a
     restore that half-applies, and a routine that re-labels nights it
     never covered. */

  // RFC 4180 in reverse, so the round-trip is asserted against a reader that
  // knows nothing about how csvText wrote it.
  const parseCsv = text => {
    const rows = [[]];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c !== '"') field += c;
        else if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
        continue;
      }
      if (c === '"') { quoted = true; continue; }
      if (c === ',') { rows[rows.length - 1].push(field); field = ''; continue; }
      if (c === '\r' && text[i + 1] === '\n') {
        rows[rows.length - 1].push(field);
        field = '';
        rows.push([]);
        i++;
        continue;
      }
      field += c;
    }
    if (field !== '' || rows[rows.length - 1].length) rows[rows.length - 1].push(field);
    if (!rows[rows.length - 1].length) rows.pop();
    return rows;
  };

  t('CSV quoting survives a note with a comma, a quote and a newline', () => {
    const doc = emptyDoc();
    const night = ensureNight(doc, '2026-09-13');
    const note = 'wet, "soaked"\nand upset';
    night.morning.note = note;
    night.morning.changes = 0;
    night.evening.asleepAt = '2026-09-13T20:00:00+02:00';
    const ev = newEvent('wet', '2026-09-14T02:12:00+02:00');
    ev.id = 'e-csv001';
    insertEvent(night, ev);

    assert(csvEscape(note) === '"wet, ""soaked""\nand upset"', 'the note was not quoted per RFC 4180');
    assert(csvEscape(null) === '', 'a null field is not blank');
    assert(csvEscape(0) === '0', 'a zero was exported as blank');
    assert(csvEscape(false) === 'no', 'an answered false lost its answer');

    const [header] = csvRows(doc, null, null);
    const back = parseCsv(csvText(doc, null, null));
    const at = name => back[1][header.indexOf(name)];
    assert(back.length === 2, `expected one night row, got ${back.length - 1}`);
    assert(at('morning_note') === note, 'the note did not round-trip');
    assert(at('outcome') === '', 'an unreviewed night exported an outcome');
    assert(at('changes') === '0', 'a recorded zero came back blank');
    assert(at('wet_events_recorded') === '1', 'the wet event was not counted');
    assert(at('hours_after_asleep') === '6.2', `first wetting was ${at('hours_after_asleep')}h, expected 6.2`);
    return 'Quoted, doubled, and read back identical · nulls blank · 0 stays 0';
  });

  // The difference an exported 0 hides: nobody recorded an evening at all, or
  // someone answered "none". Only the second is a zero.
  t('An unrecorded evening exports a blank drink count, a confirmed none exports 0', () => {
    const doc = emptyDoc();
    const quiet = ensureNight(doc, '2026-09-11');
    const none = ensureNight(doc, '2026-09-12');
    setNoDrinks(none.evening, true);
    const two = ensureNight(doc, '2026-09-13');
    addDrink(two.evening, newDrink('2026-09-13T19:30:00+02:00', 'cup'));

    const [header, ...rows] = csvRows(doc, null, null);
    const at = (i, name) => rows[i][header.indexOf(name)];
    assert(at(0, 'evening_drinks') === null, `an unanswered evening exported ${JSON.stringify(at(0, 'evening_drinks'))}`);
    assert(csvEscape(at(0, 'evening_drinks')) === '', 'the unknown drink count was not a blank cell');
    assert(at(1, 'evening_drinks') === 0, 'a confirmed no-drinks night did not export 0');
    assert(at(2, 'evening_drinks') === 1, 'a recorded drink was not counted');
    assert(quiet.evening.drinks.length === 0 && two.evening.drinks.length === 1, 'csvRows changed the document');
    assert(header.includes('wet_events_recorded') && !header.includes('wet_events'),
      'the event columns are not named as counts of recorded events');
    return 'Unknown blank · confirmed none 0 · one drink 1 · headers say "recorded"';
  });

  t('A file that is not a backup is refused without touching the log', () => {
    const local = emptyDoc();
    ensureNight(local, '2026-09-12');
    const before = JSON.stringify(local);

    assert(readBackup('{ not json').message === 'This file isn’t a readable backup.', 'broken JSON got the wrong message');
    assert(readBackup('night,routine,wore\n2026-09-13,,').message === 'This is a CSV file, not a JSON backup.', 'a CSV was not recognised');
    assert(readBackup(JSON.stringify({ version: 2, nights: [], experiments: [], settings: {} })).message
      === 'This backup needs a newer version of PeeLog.', 'a newer version was not refused');
    assert(readBackup(JSON.stringify({ hello: 'world' })).ok === false, 'a JSON file that is not a backup was accepted');
    assert(readBackup(JSON.stringify(local)).ok === true, 'a real backup was refused');
    assert(JSON.stringify(local) === before, 'reading a backup changed the local document');
    return 'Broken JSON, a CSV and a newer version each named · nothing changed';
  });

  t('Add missing nights keeps the dates already on this phone', () => {
    const make = ids => { const d = emptyDoc(); for (const id of ids) ensureNight(d, id); return d; };
    const local = make(['2026-09-11', '2026-09-12']);
    const incoming = make(['2026-09-10', '2026-09-11']);
    // A local night that also exists in the file must come out untouched.
    findNight(local, '2026-09-11').morning.outcome = 'dry';

    const plan = restorePlan(local, incoming, 'add');
    assert(plan.added === 1 && plan.skipped === 1, `add plan said ${plan.added} added / ${plan.skipped} skipped`);

    const replace = restorePlan(local, incoming, 'replace');
    assert(replace.replaced === 2, `replace reported ${replace.replaced} local nights, expected 2`);
    assert(replace.added === 2 && replace.skipped === 0, 'replace skipped something');

    const next = applyRestore(local, incoming, 'add');
    assert(!next.error, `add failed: ${next.error}`);
    assert(next.nights.map(n => n.id).join() === '2026-09-10,2026-09-11,2026-09-12', 'merged nights are out of order or missing');
    assert(findNight(next, '2026-09-11').morning.outcome === 'dry', 'an existing date was overwritten');

    const replaced = applyRestore(local, incoming, 'replace');
    assert(replaced.nights.map(n => n.id).join() === '2026-09-10,2026-09-11', 'replace did not take the file wholesale');
    return '1 added, 1 skipped, order kept · replace reports 2 local nights';
  });

  t('A damaged routine reference blocks the whole restore', () => {
    const local = emptyDoc();
    ensureNight(local, '2026-09-12');
    const incoming = emptyDoc();
    ensureNight(incoming, '2026-09-10').experimentId = 'exp-ghost';
    ensureNight(incoming, '2026-09-11');
    const localBefore = JSON.stringify(local);
    const incomingBefore = JSON.stringify(incoming);

    const plan = restorePlan(local, incoming, 'add');
    assert(plan.conflicts.length === 1, `expected 1 conflict, got ${plan.conflicts.length}`);
    assert(plan.conflicts[0].id === '2026-09-10', 'the conflict named the wrong night');
    assert(plan.blocked === true, 'a damaged routine reference did not block the plan');

    const result = applyRestore(local, incoming, 'add');
    assert(result.error, 'a damaged reference was applied anyway');
    assert(JSON.stringify(local) === localBefore, 'the local document changed on a refused restore');
    assert(JSON.stringify(incoming) === incomingBefore, 'the backup was mutated while being read');

    // With the routine present, the same file applies and brings it along.
    incoming.experiments.push({ id: 'exp-ghost', name: 'Earlier lights out', from: '2026-09-10', to: null, note: '' });
    const fixed = applyRestore(local, incoming, 'add');
    assert(!fixed.error, `the repaired backup still failed: ${fixed.error}`);
    assert(fixed.experiments.length === 1, 'the referenced routine was not imported');
    return 'Blocked, nothing applied, both documents unchanged · repaired file imports its routine';
  });

  // The boundary-move case: an event moved to another night, the blank source
  // night was deleted here, and the backup still carries it with that event id.
  // Adding it back would make one of the two unreachable, so that one night is
  // skipped — and the rest of the file still lands.
  t('A night whose entry is already here is skipped, not a reason to refuse the file', () => {
    const local = emptyDoc();
    const kept = ensureNight(local, '2026-09-12');
    const moved = newEvent('wet', '2026-09-12T23:40:00+02:00');
    moved.id = 'e-moved01';
    insertEvent(kept, moved);
    addDrink(kept.evening, newDrink('2026-09-12T19:00:00+02:00', 'cup'));
    kept.evening.drinks[0].id = 'd-shared1';

    const incoming = emptyDoc();
    const source = ensureNight(incoming, '2026-09-10');
    const same = newEvent('wet', '2026-09-10T23:40:00+02:00');
    same.id = 'e-moved01';
    insertEvent(source, same);
    const drinkNight = ensureNight(incoming, '2026-09-11');
    addDrink(drinkNight.evening, newDrink('2026-09-11T19:00:00+02:00', 'cup'));
    drinkNight.evening.drinks[0].id = 'd-shared1';
    ensureNight(incoming, '2026-09-09');

    const plan = restorePlan(local, incoming, 'add');
    assert(plan.blocked === false, 'an id collision was treated as a structural failure');
    assert(plan.collided === 2, `expected 2 collided nights, got ${plan.collided}`);
    assert(plan.collidedIds.join() === '2026-09-10,2026-09-11', `collided dates were ${plan.collidedIds.join()}`);
    assert(plan.conflicts.map(c => c.reason).join() === 'event-id,drink-id',
      `conflict reasons were ${plan.conflicts.map(c => c.reason).join()}`);
    assert(plan.added === 1, `expected 1 addable night, got ${plan.added}`);

    const next = applyRestore(local, incoming, 'add');
    assert(!next.error, `the whole file was refused: ${next.error}`);
    assert(next.nights.map(n => n.id).join() === '2026-09-09,2026-09-12', 'the wrong nights were merged');
    assert(validateDoc(next).ok, 'the merged document does not validate');

    // Replace takes the file wholesale, so nothing it carries can collide.
    const replace = restorePlan(local, incoming, 'replace');
    assert(replace.collided === 0 && replace.added === 3, 'replace skipped a night over an id it is about to drop');
    const replaced = applyRestore(local, incoming, 'replace');
    assert(!replaced.error && replaced.nights.length === 3, 'replace did not take the file wholesale');
    return '2 nights skipped by event and drink id · the third added · replace unaffected';
  });

  t('A routine tags its own nights and no earlier ones', () => {
    const doc = emptyDoc();
    for (const id of ['2026-08-31', '2026-09-01', '2026-09-02']) ensureNight(doc, id);
    const exp = newExperiment('Earlier lights out', '2026-09-01', '');
    doc.experiments.push(exp);
    assert(assignExperiment(doc, exp) === 2, 'the wrong number of nights joined the routine');
    assert(findNight(doc, '2026-08-31').experimentId === null, 'a night before the start was rewritten');
    assert(findNight(doc, '2026-09-01').experimentId === exp.id, 'the start evening did not join');

    // A night created afterwards tags itself, and one backfilled before the
    // start still does not.
    assert(ensureNight(doc, '2026-09-03').experimentId === exp.id, 'a new night did not pick up the routine');
    assert(ensureNight(doc, '2026-08-30').experimentId === null, 'a backfilled older night was tagged');

    endExperiment(doc, exp.id, '2026-09-02');
    assert(exp.to === '2026-09-02', 'the end date was not recorded');
    assert(findNight(doc, '2026-09-02').experimentId === exp.id, 'the last included evening lost its routine');
    assert(findNight(doc, '2026-09-03').experimentId === null, 'a night past the end kept the routine');
    assert(ensureNight(doc, '2026-09-04').experimentId === null, 'a night after the end was assigned to it');
    return 'Tags from the start evening on · ends inclusive, later nights unassigned';
  });

  t('The summary sheet counts its own denominators', () => {
    const doc = emptyDoc();
    const first = ensureNight(doc, '2026-09-10');
    first.morning.outcome = 'dry';
    first.morning.sleepSigns = ['snoring'];
    first.day.stool = 'hard';
    first.day.urgency = true;
    first.day.toiletCount = 6;

    const second = ensureNight(doc, '2026-09-11');
    second.morning.outcome = 'wet';
    second.evening.asleepAt = '2026-09-11T20:00:00+02:00';
    const ev = newEvent('wet', '2026-09-12T00:00:00+02:00');
    ev.id = 'e-sum001';
    ev.noticed = 'self';
    insertEvent(second, ev);

    const s = summaryData(doc, '2026-09-10', '2026-09-11', new Date(2026, 8, 13, 9, 0));
    assert(s.nights === 2, `range held ${s.nights} nights`);
    assert(s.sample === false, 'a real document was marked Sample');
    assert(s.coverage.reviewed === 2, 'coverage lost a reviewed night');
    assert(s.wet.wet === 1 && s.wet.reviewed === 2, 'wet nights counted wrong');
    assert(s.wet.rate === null, 'a rate was published below the sample threshold');
    assert(s.first.eligible === 1 && s.first.median === 4, `first wetting was ${s.first.median}h, expected 4`);
    assert(s.noticed.self === 1 && s.noticed.known === 1, 'noticing lost its denominator');
    // night.day describes the day AFTER that night, so 09-10's hard stool is
    // the daytime preceding 09-11 — one recorded answer, not two.
    assert(s.bowel.recorded === 1 && s.bowel.counts.hard === 1, 'the bowel tally is off by a night');
    assert(s.sleep.answered === 1 && s.sleep.snoring === 1, 'sleep signs lost their denominator');
    assert(s.daytime.days === 1 && s.daytime.urgency.yes === 1, 'daytime answers counted wrong');
    assert(s.daytime.toilet.min === 6 && s.daytime.toilet.max === 6, 'toilet range is wrong');
    assert(daysSince('2026-09-11T09:00:00+02:00', new Date(2026, 8, 13, 9, 0)) === 2, 'daysSince miscounted');
    return '2 nights · 1 wet of 2 reviewed · median 4h · bowel read from the night before';
  });

  t('A redraw waits for an open time picker', () => {
    // iOS commits on every wheel tick; the screen must not be rebuilt under
    // the finger. Focus is stood in for, since taking real focus here would
    // open a picker on the phone.
    const el = h('div');
    const input = h('input', { type: 'time', k: 'probe' });
    el.append(input);
    paint(el, [h('p', { text: 'first' })], input);
    assert(el.firstChild === input, 'the focused picker was replaced');
    paint(el, [h('p', { text: 'second' })], input);
    assert(el.firstChild === input, 'a second redraw replaced the focused picker');
    paint(el, [h('p', { text: 'third' })], null);
    assert(el.firstChild?.textContent === 'third', 'an unfocused redraw did not paint');
    return 'Held while focused, painted when not';
  });

  t('The real document was not touched', () => {
    assert(TEST_KEY !== STORE_KEY, 'the tests are pointed at the live key');
    let after = null;
    try { after = localStorage.getItem(STORE_KEY); } catch { return 'localStorage unavailable here'; }
    assert(after === liveBefore, `${STORE_KEY} changed while the tests ran`);
    return `${STORE_KEY} unchanged`;
  });

  rows.unshift(failed
    ? bad('Self-tests', `${failed} of ${rows.length} failed`)
    : ok('Self-tests', `${rows.length} checks passed`));
  return [...rows, ...metricsSelfTests()];
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
