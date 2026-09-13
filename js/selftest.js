// Diagnostics for the install check, and the closest thing this app has to a
// test suite. Every row here is something the app depends on, phrased so it
// can be read on the phone at a glance.

import { createStore, STORE_KEY } from './store.js';
import {
  activeNightFor, composeIso, dateForNightTime, dayDateFor, emptyDoc,
  eventSummary, exportFileName, findNight, insertEvent, isReviewed, latestEvent,
  migrate, newEvent, newNight, nightIdFor, nightIdForIso, openNight,
  outcomeConflict, parseIso, pendingReviewFor, prevNightId, removeEvent, toIso,
  validateDoc,
} from './model.js';

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

    const bare = structuredClone(doc);
    bare.nights[0].events[0].t = '2026-09-13T22:00';
    assert(!validateDoc(bare).ok, 'a timestamp without an offset was accepted');

    const swapped = structuredClone(doc);
    swapped.nights[0].events.reverse();
    assert(!validateDoc(swapped).ok, 'out-of-order events were accepted');

    const dupes = structuredClone(doc);
    dupes.nights.push(structuredClone(dupes.nights[0]));
    assert(!validateDoc(dupes).ok, 'duplicate night ids were accepted');

    const wrongType = structuredClone(doc);
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
  return rows;
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
