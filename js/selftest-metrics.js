// M4's test suite: metrics.js and charts.js against three hand-checked fixture
// documents. Same `{ k, v, s }` row shape as selftest.js — the orchestrator
// imports `metricsSelfTests()` and appends its rows to the Check tab.
//
// IMPLEMENTATION.md §5: "a metric that is quietly wrong is worse than a metric
// that is missing, because it will be used to make one of the three decisions
// in §1 of DESIGN.md". So every expectation below is a number worked out by
// hand from the fixture, not read back off the implementation.
//
// Nothing here touches storage. The fixtures are built in memory from
// model.js's own constructors, so a schema change breaks these tests rather
// than silently passing against a stale shape.

import {
  insertEvent, newEvent, newNight, shiftDate,
} from './model.js';
import {
  askedToPee, bowelComparison, coverage, drinksComparison, firstWetting,
  lastCompletedNightId, lastToiletComparison, liftComparison, nightsInRange,
  noticed, rangeFor, routineComparison, wetNights, wetNightsByWeek,
  wettingsPerWetNight,
} from './metrics.js';
import { barSeries, comparison, dotPlot, textEquivalent } from './charts.js';

const ok = (k, v) => ({ k, v, s: 'ok' });
const bad = (k, v) => ({ k, v, s: 'bad' });

/* ── Fixture plumbing ───────────────────────────────────────────────── */

const pad = n => String(n).padStart(2, '0');

// A wall clock plus the offset it was recorded at. Hard-coded rather than
// derived from the runtime zone: the whole point of these fixtures is that the
// numbers do not move when the device's zone does.
const stamp = (dateStr, hh, mm, off) => `${dateStr}T${pad(hh)}:${pad(mm)}:00${off}`;

// `hours` after 20:00 on the night's own evening, rolling to the next calendar
// date past midnight.
const afterEvening = (id, startHour, hours, off) => {
  const h = startHour + hours;
  return stamp(h >= 24 ? shiftDate(id, 1) : id, h % 24, 0, off);
};

// `minutes` earlier the same evening — the last toilet visit before bedtime.
const before = (id, hh, mm, minutes, off) => {
  const total = hh * 60 + mm - minutes;
  return stamp(id, Math.floor(total / 60), total % 60, off);
};

function makeNight(id, patch = {}) {
  const n = newNight(id);
  Object.assign(n.evening, patch.evening ?? {});
  Object.assign(n.morning, patch.morning ?? {});
  Object.assign(n.day, patch.day ?? {});
  for (const [type, t, fields] of patch.events ?? []) {
    const ev = newEvent(type, t);
    Object.assign(ev, fields ?? {});
    insertEvent(n, ev);
  }
  return n;
}

const docOf = (nights, experiments = []) => ({
  version: 1, activeNightId: null, nights, experiments,
  settings: { lastBackupAt: null, lastBackupConfirmedAt: null, art: true },
});

/* ── Fixture A · five nights, hand-written ──────────────────────────────
   Small enough to read whole. Carries the awkward cases: a wet outcome with
   no events, a wet event on an unreviewed night, a confirmed "no drinks"
   with no dinner time beside it, and a bowel chain whose values differ from
   both neighbours so an off-by-one shows up as a wrong group. */

const CEST = '+02:00';

function fixtureSmall() {
  return docOf([
    makeNight('2026-09-01', {
      // noDrinks confirmed but dinnerAt unknown: a confirmed none needs no
      // dinner time to be a none.
      evening: { noDrinks: true, dinnerAt: null, asleepAt: stamp('2026-09-01', 20, 30, CEST), lastToiletAt: stamp('2026-09-01', 20, 0, CEST) },
      morning: { outcome: 'dry', eventsComplete: true },
      day: { stool: 'hard' },
    }),
    makeNight('2026-09-02', {
      evening: {
        dinnerAt: stamp('2026-09-02', 18, 0, CEST),
        drinks: [{ id: 'd1', at: stamp('2026-09-02', 19, 0, CEST), size: 'cup' }],
        asleepAt: stamp('2026-09-02', 20, 30, CEST),
        lastToiletAt: stamp('2026-09-02', 19, 15, CEST),
      },
      morning: { outcome: 'wet' },
      day: { stool: 'normal' },
      events: [['wet', stamp('2026-09-03', 2, 0, CEST), { noticed: 'self' }]],
    }),
    // Confirmed wet, no event detail: not zero wettings, excluded and disclosed.
    makeNight('2026-09-03', {
      evening: { asleepAt: stamp('2026-09-03', 20, 0, CEST) },
      morning: { outcome: 'wet' },
    }),
    // Wet recorded, review due: the event is real, the night's outcome is not
    // confirmed, so it is excluded from every finalised rate.
    makeNight('2026-09-04', {
      evening: { asleepAt: stamp('2026-09-04', 21, 0, CEST) },
      day: { stool: 'none' },
      events: [['wet', stamp('2026-09-05', 1, 0, CEST), { noticed: 'parent' }]],
    }),
    makeNight('2026-09-05', {
      evening: {
        dinnerAt: stamp('2026-09-05', 18, 0, CEST),
        // Logged before dinner, so there were no post-dinner drinks.
        drinks: [{ id: 'd2', at: stamp('2026-09-05', 17, 0, CEST), size: 'sip' }],
        asleepAt: stamp('2026-09-05', 20, 45, CEST),
        lastToiletAt: stamp('2026-09-05', 20, 0, CEST),
      },
      morning: { outcome: 'dry', eventsComplete: true },
      day: { stool: 'loose' },
      events: [
        ['selfToilet', stamp('2026-09-05', 23, 0, CEST), {}],
        ['lift', stamp('2026-09-05', 23, 30, CEST), {}],
      ],
    }),
  ]);
}

/* ── Fixture B · thirty nights across the DST change ────────────────────
   Europe/Belgrade puts the clock back at 03:00 on 2026-10-25. Every night is
   asleep 20:30 → first wetting 02:00, which is 5.5 hours on both sides of
   that change only if the stored offsets are honoured. The night of
   2026-10-24 carries its wetting at 03:30 CET instead: that window really
   does contain the fall-back, so it is 8 hours, and a wall-clock subtraction
   would report 7. */

const EVENING_OFF = id => (id <= '2026-10-24' ? '+02:00' : '+01:00');
const WET_OFF = id => (id < '2026-10-24' ? '+02:00' : '+01:00');

function fixtureDst() {
  const nights = [];
  for (let i = 0; i < 30; i++) {
    const id = shiftDate('2026-10-10', i);
    const off = EVENING_OFF(id);
    const wetOff = WET_OFF(id);
    const isWet = i % 2 === 0;
    const events = [];
    if (i % 5 === 0) events.push(['selfToilet', stamp(id, 23, 0, off), {}]);
    if (i % 3 === 0) events.push(['lift', stamp(id, 23, 30, off), {}]);
    if (isWet) {
      const noticedValue = i % 4 === 0 ? 'self' : i % 8 === 2 ? null : 'parent';
      const t = id === '2026-10-24'
        ? stamp('2026-10-25', 3, 30, wetOff)
        : stamp(shiftDate(id, 1), 2, 0, wetOff);
      events.push(['wet', t, { noticed: noticedValue }]);
    }
    const beforeAsleep = i < 12 ? 20 : i < 24 ? 45 : 90;
    nights.push(makeNight(id, {
      evening: {
        asleepAt: stamp(id, 20, 30, off),
        lastToiletAt: before(id, 20, 30, beforeAsleep, off),
        dinnerAt: i >= 15 ? stamp(id, 18, 0, off) : null,
        drinks: i >= 15 ? [{ id: `d${i}`, at: stamp(id, 19, 0, off), size: 'cup' }] : [],
        noDrinks: i < 15 ? true : null,
      },
      morning: { outcome: isWet ? 'wet' : 'dry', eventsComplete: true },
      day: { stool: i % 2 === 0 ? 'normal' : 'hard' },
      events,
    }));
  }
  return docOf(nights, [{ id: 'exp-1', name: 'Earlier lights out', from: '2026-10-25', to: null, note: '' }]);
}

/* ── Fixture C · sixty nights with mixed unknowns ───────────────────────
   The realistic shape: gaps everywhere, several groups sitting exactly on
   the ten-record threshold, and one night whose wetting is stamped before
   its asleep time. */

function fixtureLarge() {
  const nights = [];
  for (let i = 0; i < 60; i++) {
    const id = shiftDate('2026-06-01', i);
    const off = CEST;
    const reviewed = i % 10 !== 9;
    const isWet = reviewed && i % 3 === 0;
    const knowsAsleep = i % 7 !== 5;
    const asleepAt = knowsAsleep ? stamp(id, 20, 0, off) : null;

    const events = [];
    if (i % 5 === 0) events.push(['selfToilet', stamp(id, 23, 0, off), {}]);
    if (i % 4 === 1) events.push(['lift', stamp(id, 23, 30, off), {}]);
    // Wet events exist on the reviewed wet nights that are not multiples of
    // nine, plus two unreviewed nights.
    const hasWetEvents = (isWet && i % 9 !== 0) || i === 9 || i === 19;
    if (hasWetEvents) {
      const noticedValue = ['self', 'parent', 'parent', null][i % 4];
      if (i === 6) {
        // Stamped an hour before she fell asleep — excluded as out of order.
        events.push(['wet', stamp(id, 19, 0, off), { noticed: noticedValue }]);
      } else {
        const hours = 2 + (i % 5);
        events.push(['wet', afterEvening(id, 20, hours, off), { noticed: noticedValue }]);
        if (i % 6 === 3) events.push(['wet', afterEvening(id, 20, hours + 1, off), { noticed: noticedValue }]);
      }
    }

    const drinkMode = i % 4;
    const evening = { asleepAt };
    if (drinkMode === 0) evening.noDrinks = true;
    else if (drinkMode === 1) {
      evening.dinnerAt = i === 1 ? null : stamp(id, 18, 0, off);
      evening.drinks = [{ id: `d${i}`, at: i === 5 ? null : stamp(id, 19, 0, off), size: 'sip' }];
    } else if (drinkMode === 2) {
      evening.dinnerAt = stamp(id, 18, 0, off);
      evening.drinks = [{
        id: `d${i}`,
        at: stamp(id, i === 6 ? 17 : 19, 0, off),
        size: i === 2 ? null : 'cup',
      }];
    }
    // drinkMode 3 leaves drinks [] and noDrinks null — unknown, not "none".

    const beforeAsleep = [20, 45, 90, 20, 45][i % 5];
    if (knowsAsleep) {
      evening.lastToiletAt = i === 4
        ? stamp(id, 20, 10, off) // after asleep: out of order
        : before(id, 20, 0, beforeAsleep, off);
    }

    nights.push(makeNight(id, {
      evening,
      morning: {
        outcome: reviewed ? (isWet ? 'wet' : 'dry') : null,
        eventsComplete: i % 3 === 2 ? null : true,
      },
      day: { stool: [null, 'none', 'hard', 'normal', 'loose'][i % 5] },
      events,
    }));
  }
  return docOf(nights, [
    { id: 'exp-a', name: 'Ongoing', from: '2026-07-01', to: null, note: '' },
    { id: 'exp-b', name: 'Ended', from: '2026-06-10', to: '2026-06-20', note: '' },
  ]);
}

/* ── Assertions ─────────────────────────────────────────────────────── */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const show = v => (v === null ? 'null' : typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v));

function eq(actual, expected, what) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert(Math.abs(actual - expected) < 1e-9, `${what}: ${show(actual)} ≠ ${show(expected)}`);
    return;
  }
  assert(actual === expected, `${what}: ${show(actual)} ≠ ${show(expected)}`);
}

const group = (result, key) => {
  const g = result.groups.find(x => x.key === key);
  assert(g, `no group ${key}`);
  return g;
};

// wet, dry and eligible in one line — the three numbers a comparison arm is.
function eqGroup(result, key, wet, dry, eligible, what) {
  const g = group(result, key);
  eq(g.wet, wet, `${what} ${key}.wet`);
  eq(g.dry, dry, `${what} ${key}.dry`);
  eq(g.eligible, eligible, `${what} ${key}.eligible`);
}

export function metricsSelfTests() {
  const rows = [];
  const t = (name, fn) => {
    try {
      rows.push(ok(name, fn() || 'Passed'));
    } catch (err) {
      rows.push(bad(name, err.message || String(err)));
    }
  };

  const small = fixtureSmall();
  const dst = fixtureDst();
  const large = fixtureLarge();
  const allOf = doc => doc.nights;

  /* ── Range ──────────────────────────────────────────────────────── */

  t('Range ends at the last completed night', () => {
    // 20:00 on 6 September is inside the night of the 6th, which is still
    // open — the last completed night is the 5th.
    eq(lastCompletedNightId(new Date(2026, 8, 6, 20, 0)), '2026-09-05', 'evening');
    // 03:00 on 6 September is inside the night of the 5th.
    eq(lastCompletedNightId(new Date(2026, 8, 6, 3, 0)), '2026-09-04', 'small hours');
    const r7 = rangeFor('7d', new Date(2026, 8, 6, 20, 0));
    eq(r7.fromId, '2026-08-30', '7d from');
    eq(r7.toId, '2026-09-05', '7d to');
    eq(r7.length, 7, '7d length');
    const r28 = rangeFor('28d', new Date(2026, 8, 6, 20, 0));
    eq(r28.fromId, '2026-08-09', '28d from');
    eq(r28.toId, '2026-09-05', '28d to');
    return '7d 30 Aug–5 Sep, 28d 9 Aug–5 Sep at 20:00 on 6 Sep';
  });

  t('nightsInRange is inclusive and ascending', () => {
    const got = nightsInRange(small, '2026-09-02', '2026-09-04');
    eq(got.length, 3, 'count');
    eq(got[0].id, '2026-09-02', 'first');
    eq(got[2].id, '2026-09-04', 'last');
    eq(nightsInRange(small, '2026-09-04', '2026-09-02').length, 0, 'reversed range');
    eq(nightsInRange(small, '2026-10-01', '2026-10-31').length, 0, 'empty range');
    return '3 nights, both ends included';
  });

  /* ── Fixture A ──────────────────────────────────────────────────── */

  t('A · coverage separates unreviewed from wet-recorded', () => {
    const c = coverage(allOf(small));
    eq(c.total, 5, 'total');
    eq(c.reviewed, 4, 'reviewed');
    eq(c.unreviewed, 1, 'unreviewed');
    eq(c.wetRecordedReviewDue, 1, 'wetRecordedReviewDue');
    return '5 nights · 4 reviewed · 1 wet recorded, review due';
  });

  t('A · wet nights exclude the review-due night', () => {
    const w = wetNights(allOf(small));
    eq(w.wet, 2, 'wet');
    eq(w.dry, 2, 'dry');
    eq(w.reviewed, 4, 'reviewed');
    eq(w.excludedReviewDue, 1, 'excludedReviewDue');
    eq(w.rate, null, 'rate');
    eq(w.ratePerWeek, null, 'ratePerWeek');
    eq(w.insufficient, true, 'insufficient');
    return '2 wet of 4 reviewed, no rate below 10';
  });

  t('A · first wetting: hours, not clock time', () => {
    const f = firstWetting(allOf(small));
    eq(f.points.length, 2, 'points');
    eq(f.points[0].id, '2026-09-02', 'first point night');
    eq(f.points[0].hours, 5.5, '2 Sep hours');      // 20:30 → 02:00
    eq(f.points[1].id, '2026-09-04', 'second point night');
    eq(f.points[1].hours, 4, '4 Sep hours');         // 21:00 → 01:00
    eq(f.excluded.noWet, 1, 'noWet');                // 3 Sep: wet outcome, no events
    eq(f.excluded.noAsleep, 0, 'noAsleep');
    eq(f.excluded.invalidOrder, 0, 'invalidOrder');
    eq(f.median, 4.75, 'median');
    return '5.5 h and 4.0 h · median 4.75 · 1 wet night without detail excluded';
  });

  t('A · a wet outcome without events is not zero wettings', () => {
    const w = wettingsPerWetNight(allOf(small));
    eq(w.events, 1, 'events');
    eq(w.nights, 1, 'nights');
    eq(w.mean, 1, 'mean');
    eq(w.excludedNoEvents, 1, 'excludedNoEvents');   // 3 Sep
    eq(w.excluded.reviewDue, 1, 'reviewDue');        // 4 Sep, unreviewed
    return '1 wetting over 1 detailed wet night · 1 excluded for no detail';
  });

  t('A · noticed counts events, unknowns kept separate', () => {
    const n = noticed(allOf(small));
    eq(n.self, 1, 'self');
    eq(n.parent, 1, 'parent');
    eq(n.unknown, 0, 'unknown');
    eq(n.events, 2, 'events');
    eq(n.share, null, 'share');
    eq(n.insufficient, true, 'insufficient');
    return '1 self, 1 parent, no share below 10 known events';
  });

  t('A · asked to pee is independent of the outcome', () => {
    const a = askedToPee(allOf(small));
    eq(a.nights, 1, 'nights');     // 5 Sep, which was dry
    eq(a.reviewed, 4, 'reviewed');
    eq(a.share, null, 'share');
    return '1 of 4 reviewed nights, counted on a dry night';
  });

  t('A · confirmed none needs no dinner time; empty drinks is unknown', () => {
    const d = drinksComparison(allOf(small));
    // 1 Sep noDrinks with dinnerAt null, and 5 Sep whose only drink was
    // before dinner, are both a confirmed "none after dinner".
    eqGroup(d, 'none', 0, 2, 2, 'A drinks');
    eqGroup(d, 'sip', 0, 0, 0, 'A drinks');
    eqGroup(d, 'cup+', 1, 0, 1, 'A drinks');
    eq(d.excluded.unknownDrinks, 1, 'unknownDrinks');  // 3 Sep: drinks [] and noDrinks null
    eq(d.excluded.reviewDue, 1, 'reviewDue');          // 4 Sep
    eq(d.insufficient, true, 'insufficient');
    return 'none 2 · cup+ 1 · 1 unknown · 1 review due';
  });

  t('A · last-toilet groups by minutes before asleep', () => {
    const l = lastToiletComparison(allOf(small));
    eqGroup(l, 'le30', 0, 1, 1, 'A toilet');     // 1 Sep: 20:00 → 20:30
    eqGroup(l, '31to60', 0, 1, 1, 'A toilet');   // 5 Sep: 20:00 → 20:45
    eqGroup(l, 'gt60', 1, 0, 1, 'A toilet');     // 2 Sep: 19:15 → 20:30
    eq(l.excluded.unknownTimes, 1, 'unknownTimes');
    eq(l.excluded.reviewDue, 1, 'reviewDue');
    return '30 / 45 / 75 minutes land in the three groups';
  });

  t('A · no-lift needs eventsComplete', () => {
    const l = liftComparison(allOf(small));
    eq(l.measure, 'dry', 'measure');
    eqGroup(l, 'lift', 0, 1, 1, 'A lift');       // 5 Sep
    eqGroup(l, 'noLift', 0, 1, 1, 'A lift');     // 1 Sep, eventsComplete true
    // 2 and 3 Sep have no lift and no completeness answer: an empty event
    // list cannot establish that no lift happened.
    eq(l.excluded.incompleteRecord, 2, 'incompleteRecord');
    eq(l.excluded.reviewDue, 1, 'reviewDue');
    return 'lift 1 · noLift 1 · 2 nights cannot establish "no lift"';
  });

  t('A · bowel overlay reads night N−1’s day, not N’s and not N+1’s', () => {
    const b = bowelComparison(allOf(small), small);
    // Night 2 Sep is wet and its group must be 'hard' — 1 Sep's day.stool.
    // Its own day is 'normal' and 3 Sep's is null, so a one-day slip in
    // either direction changes the answer.
    eqGroup(b, 'hard', 1, 0, 1, 'A bowel');
    eqGroup(b, 'normal', 1, 0, 1, 'A bowel');    // 3 Sep, from 2 Sep's day
    eqGroup(b, 'none', 0, 1, 1, 'A bowel');      // 5 Sep, from 4 Sep's day
    eqGroup(b, 'loose', 0, 0, 0, 'A bowel');     // 5 Sep's own day feeds nobody
    eq(b.excluded.noRecord, 1, 'noRecord');      // 1 Sep, no 31 Aug in the doc
    eq(b.excluded.reviewDue, 1, 'reviewDue');
    return '2 Sep → hard (1 Sep’s day); own day normal, next day null';
  });

  /* ── Fixture B ──────────────────────────────────────────────────── */

  t('B · 20:30 → 02:00 is 5.5 hours on both sides of the DST change', () => {
    const f = firstWetting(allOf(dst));
    eq(f.points.length, 15, 'points');
    const by = Object.fromEntries(f.points.map(p => [p.id, p.hours]));
    eq(by['2026-10-22'], 5.5, 'before the change (CEST)');
    eq(by['2026-10-26'], 5.5, 'after the change (CET)');
    for (const p of f.points) {
      if (p.id !== '2026-10-24') eq(p.hours, 5.5, `${p.id} hours`);
    }
    // The one window that really contains the fall-back: 20:30+02:00 to
    // 03:30+01:00 is eight hours. Subtracting wall clocks would say seven.
    eq(by['2026-10-24'], 8, 'the night that spans the change');
    eq(f.median, 5.5, 'median');
    eq(f.insufficient, false, 'insufficient');
    return '14 nights at 5.5 h, the spanning night at 8 h, median 5.5 h';
  });

  t('B · wet-night rate and weekly buckets', () => {
    const w = wetNights(allOf(dst));
    eq(w.wet, 15, 'wet');
    eq(w.dry, 15, 'dry');
    eq(w.reviewed, 30, 'reviewed');
    eq(w.rate, 0.5, 'rate');
    eq(w.ratePerWeek, 3.5, 'ratePerWeek');
    eq(w.insufficient, false, 'insufficient');
    const weeks = wetNightsByWeek(allOf(dst), '2026-11-08', 4).weeks;
    eq(weeks.length, 4, 'weeks');
    eq(weeks[0].fromId, '2026-10-12', 'oldest bucket from');
    eq(weeks[3].toId, '2026-11-08', 'newest bucket to');
    eq(weeks.reduce((s, x) => s + x.reviewed, 0), 28, 'nights in four weeks');
    eq(weeks.reduce((s, x) => s + x.wet, 0), 14, 'wet in four weeks');
    return '15 of 30 · 3.5 per week · four 7-night buckets';
  });

  t('B · wettings, noticed and asked to pee', () => {
    const w = wettingsPerWetNight(allOf(dst));
    eq(w.events, 15, 'events');
    eq(w.nights, 15, 'nights');
    eq(w.mean, 1, 'mean');
    eq(w.excludedNoEvents, 0, 'excludedNoEvents');
    const n = noticed(allOf(dst));
    eq(n.self, 8, 'self');
    eq(n.parent, 3, 'parent');
    eq(n.unknown, 4, 'unknown');
    eq(n.known, 11, 'known');
    eq(n.share, 8 / 11, 'share');
    eq(n.insufficient, false, 'insufficient');
    const a = askedToPee(allOf(dst));
    eq(a.nights, 6, 'selfToilet nights');
    eq(a.reviewed, 30, 'reviewed');
    eq(a.share, 0.2, 'share');
    return 'mean 1.0 · noticed 8 of 11 known · asked on 6 of 30';
  });

  t('B · comparisons at full size', () => {
    const d = drinksComparison(allOf(dst));
    eqGroup(d, 'none', 8, 7, 15, 'B drinks');
    eqGroup(d, 'cup+', 7, 8, 15, 'B drinks');
    eq(group(d, 'none').rate, 8 / 15, 'none rate');
    eq(d.insufficient, false, 'drinks insufficient');

    const l = lastToiletComparison(allOf(dst));
    eqGroup(l, 'le30', 6, 6, 12, 'B toilet');
    eqGroup(l, '31to60', 6, 6, 12, 'B toilet');
    eqGroup(l, 'gt60', 3, 3, 6, 'B toilet');
    eq(group(l, 'gt60').rate, null, 'gt60 rate suppressed below 10');
    eq(l.insufficient, false, 'two groups clear the threshold');

    const f = liftComparison(allOf(dst));
    eqGroup(f, 'lift', 5, 5, 10, 'B lift');
    eqGroup(f, 'noLift', 10, 10, 20, 'B lift');
    eq(group(f, 'lift').rate, 0.5, 'lift dry rate');
    eq(f.insufficient, false, 'lift insufficient');

    const b = bowelComparison(allOf(dst), dst);
    eqGroup(b, 'normal', 0, 15, 15, 'B bowel');
    eqGroup(b, 'hard', 14, 0, 14, 'B bowel');
    eq(b.excluded.noRecord, 1, 'first night has no day before it');
    return 'drinks 15/15 · toilet 12/12/6 · lift 10/20 · bowel 15/14';
  });

  t('B · routine windows are equal and end the night before it started', () => {
    const r = routineComparison(dst, dst.experiments[0], new Date(2026, 10, 9, 20, 0));
    eq(r.windowNights, 15, 'windowNights');
    eq(r.during.fromId, '2026-10-25', 'during from');
    eq(r.during.toId, '2026-11-08', 'during to');
    eq(r.before.toId, '2026-10-24', 'before ends the night before the start');
    eq(r.before.fromId, '2026-10-10', 'before from');
    eq(r.during.reviewed, 15, 'during reviewed');
    eq(r.before.reviewed, 15, 'before reviewed');
    eq(r.during.wet, 7, 'during wet');
    eq(r.before.wet, 8, 'before wet');
    eq(r.insufficient, false, 'insufficient');
    return 'two 15-night windows · before 8 of 15 · during 7 of 15';
  });

  /* ── Fixture C ──────────────────────────────────────────────────── */

  t('C · coverage and rate over sixty mixed nights', () => {
    const c = coverage(allOf(large));
    eq(c.total, 60, 'total');
    eq(c.reviewed, 54, 'reviewed');
    eq(c.unreviewed, 6, 'unreviewed');
    eq(c.wetRecordedReviewDue, 2, 'wetRecordedReviewDue');
    const w = wetNights(allOf(large));
    eq(w.wet, 18, 'wet');
    eq(w.dry, 36, 'dry');
    eq(w.rate, 1 / 3, 'rate');
    eq(w.ratePerWeek, 2.33, 'ratePerWeek');
    eq(w.excludedReviewDue, 2, 'excludedReviewDue');
    return '18 wet of 54 reviewed · 2.33 per week · 6 unreviewed';
  });

  t('C · timing excludes missing asleep and out-of-order stamps', () => {
    const f = firstWetting(allOf(large));
    eq(f.excluded.noAsleep, 3, 'noAsleep');
    eq(f.excluded.invalidOrder, 1, 'invalidOrder');
    eq(f.excluded.noWet, 6, 'noWet');
    eq(f.points.length, 10, 'points');
    eq(f.median, 4, 'median');
    eq(f.insufficient, false, 'exactly ten points is enough');
    const w = wettingsPerWetNight(allOf(large));
    eq(w.events, 18, 'events');
    eq(w.nights, 12, 'nights');
    eq(w.mean, 1.5, 'mean');
    eq(w.excludedNoEvents, 6, 'excludedNoEvents');
    eq(w.excluded.reviewDue, 2, 'reviewDue');
    return '10 points, median 4 h · 18 wettings over 12 nights';
  });

  t('C · noticed and asked to pee', () => {
    const n = noticed(allOf(large));
    eq(n.self, 3, 'self');
    eq(n.parent, 11, 'parent');
    eq(n.unknown, 7, 'unknown');
    eq(n.events, 21, 'events');
    eq(n.share, 3 / 14, 'share');
    const a = askedToPee(allOf(large));
    eq(a.nights, 12, 'nights');
    eq(a.reviewed, 54, 'reviewed');
    eq(a.share, 12 / 54, 'share');
    return '3 of 14 known · asked on 12 of 54';
  });

  t('C · drinks: four different exclusion reasons', () => {
    const d = drinksComparison(allOf(large));
    eqGroup(d, 'none', 6, 10, 16, 'C drinks');
    eqGroup(d, 'sip', 4, 6, 10, 'C drinks');
    eqGroup(d, 'cup+', 4, 9, 13, 'C drinks');
    eq(d.excluded.unknownDrinks, 12, 'unknownDrinks');
    eq(d.excluded.noDinner, 1, 'noDinner');
    eq(d.excluded.unknownDrinkTime, 1, 'unknownDrinkTime');
    eq(d.excluded.unknownDrinkSize, 1, 'unknownDrinkSize');
    eq(d.excluded.reviewDue, 6, 'reviewDue');
    eq(group(d, 'sip').rate, 0.4, 'sip rate at exactly ten');
    eq(d.insufficient, false, 'insufficient');
    return 'none 16 · sip 10 · cup+ 13 · 21 excluded across five reasons';
  });

  t('C · last toilet, lifts and bowel', () => {
    const l = lastToiletComparison(allOf(large));
    eqGroup(l, 'le30', 7, 14, 21, 'C toilet');
    eqGroup(l, '31to60', 5, 10, 15, 'C toilet');
    eqGroup(l, 'gt60', 3, 7, 10, 'C toilet');
    eq(l.excluded.unknownTimes, 7, 'unknownTimes');
    eq(l.excluded.invalidOrder, 1, 'invalidOrder');
    eq(l.excluded.reviewDue, 6, 'reviewDue');

    const f = liftComparison(allOf(large));
    eqGroup(f, 'lift', 4, 8, 12, 'C lift');
    eqGroup(f, 'noLift', 14, 14, 28, 'C lift');
    eq(f.excluded.incompleteRecord, 14, 'incompleteRecord');
    eq(group(f, 'lift').rate, 8 / 12, 'lift dry rate');

    const b = bowelComparison(allOf(large), large);
    eqGroup(b, 'none', 4, 8, 12, 'C bowel');
    eqGroup(b, 'hard', 4, 8, 12, 'C bowel');
    eqGroup(b, 'normal', 2, 4, 6, 'C bowel');
    eqGroup(b, 'loose', 3, 8, 11, 'C bowel');
    eq(group(b, 'normal').rate, null, 'six nights is not a rate');
    eq(b.excluded.noRecord, 13, 'noRecord');
    return 'toilet 21/15/10 · lift 12/28 · bowel 12/12/6/11';
  });

  t('C · routine windows are never stretched to fill', () => {
    const ongoing = routineComparison(large, large.experiments[0], new Date(2026, 7, 1, 20, 0));
    eq(ongoing.windowNights, 31, 'ongoing windowNights');
    eq(ongoing.during.toId, '2026-07-31', 'ongoing stops at the last completed night');
    eq(ongoing.before.fromId, '2026-05-31', 'before from');
    eq(ongoing.before.toId, '2026-06-30', 'before to');
    eq(ongoing.during.reviewed, 27, 'during reviewed');
    eq(ongoing.before.reviewed, 27, 'before reviewed');
    eq(ongoing.insufficient, false, 'ongoing insufficient');

    const ended = routineComparison(large, large.experiments[1], new Date(2026, 7, 1, 20, 0));
    eq(ended.windowNights, 11, 'ended windowNights');
    eq(ended.during.fromId, '2026-06-10', 'ended during from');
    eq(ended.during.toId, '2026-06-20', 'ended during to');
    eq(ended.before.toId, '2026-06-09', 'ended before to');
    eq(ended.before.fromId, '2026-05-30', 'ended before from');
    // Two nights of the before window predate the log; they stay missing
    // rather than being made up by widening the window.
    eq(ended.before.total, 9, 'before nights actually recorded');
    eq(ended.before.reviewed, 9, 'before reviewed');
    eq(ended.during.reviewed, 9, 'during reviewed');
    eq(ended.insufficient, true, 'ended insufficient');
    return 'ongoing 31+31 nights · ended 11+11 with only 9 recorded before';
  });

  t('Routine with no completed nights yet', () => {
    const r = routineComparison(large, { id: 'x', name: 'Future', from: '2026-12-01', to: null },
      new Date(2026, 7, 1, 20, 0));
    eq(r.windowNights, 0, 'windowNights');
    eq(r.before.reviewed, 0, 'before reviewed');
    eq(r.during.reviewed, 0, 'during reviewed');
    eq(r.insufficient, true, 'insufficient');
    return 'A routine starting in the future compares nothing';
  });

  /* ── Charts ─────────────────────────────────────────────────────── */

  t('Charts build valid SVG with no stray NaN', () => {
    const weeks = wetNightsByWeek(allOf(dst), '2026-11-08', 4).weeks;
    const bars = barSeries({
      values: weeks.map((w, i) => ({ label: `W${i + 1}`, value: w.wet, kind: 'wet', n: w.reviewed })),
    });
    const dots = dotPlot({ points: firstWetting(allOf(dst)).points.map(p => ({ label: p.id, value: p.hours })) });
    const comp = comparison({ groups: liftComparison(allOf(dst)).groups, measure: 'dry' });
    for (const [name, s] of [['barSeries', bars], ['dotPlot', dots], ['comparison', comp]]) {
      assert(s.startsWith('<svg') && s.endsWith('</svg>'), `${name} is not an svg`);
      assert(!s.includes('NaN') && !s.includes('undefined'), `${name} contains NaN or undefined`);
      assert(s.includes('aria-label='), `${name} has no aria-label`);
      assert(!/#[0-9a-fA-F]{3,6}\b/.test(s), `${name} hard-codes a colour`);
    }
    assert(bars.includes('class="c-wet"'), 'bar series is not classed');
    assert(dots.includes('class="c-timing"'), 'dot plot is not classed');
    assert(barSeries({ values: [] }).includes('No nights recorded yet'), 'empty bar series says nothing');
    return 'Three builders · classed, labelled, no hard-coded colour';
  });

  t('No chart label overruns the 100-unit box', () => {
    // SVG text does not wrap and the viewBox does not scroll, so a line too
    // wide is silently cut off. 0.55 em per character is a safe overestimate
    // for the system sans stack at these sizes.
    const wide = [];
    const check = (name, s) => {
      for (const m of s.matchAll(/<text[^>]*text-anchor="(\w+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
        const [, anchor, size, body] = m;
        const width = body.length * Number(size) * 0.55;
        const x = Number(/ x="([-\d.]+)"/.exec(m[0])[1]);
        const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
        if (left < -0.5 || left + width > 100.5) wide.push(`${name}: "${body}" (${Math.round(width)}u)`);
      }
    };
    const under = { label: 'A cup or more after dinner', rate: null, wet: 0, eligible: 3 };
    check('comparison', comparison({ groups: [under, { label: 'None', rate: 0.42, wet: 5, eligible: 12 }] }));
    check('bars', barSeries({ values: [{ label: '17 Aug', value: 4, kind: 'wet', n: 7 }] }));
    check('dots', dotPlot({ points: [{ label: 'Earlier nights', value: 2 }, { label: 'Recent nights', value: 6 }] }));
    check('empty', comparison({ groups: [] }));
    assert(!wide.length, wide.join(' · '));
    return 'Every label fits, insufficiency note included';
  });

  t('Chart labels never carry a value they were not given', () => {
    const one = barSeries({ values: [{ label: 'Week', value: 0, kind: 'wet', n: 7 }] });
    assert(one.includes('>0<'), 'a zero is not printed');
    assert(!one.includes('<rect'), 'a zero drew a bar');
    const single = dotPlot({ points: [{ label: 'one', value: 3 }] });
    assert(single.includes('<circle'), 'a single point did not draw');
    return 'A zero prints as 0 and draws no bar';
  });

  t('Text equivalents carry the same numbers', () => {
    const w = wetNights(allOf(dst));
    const s = textEquivalent(w);
    assert(s.includes('15 wet of 30 nights reviewed'), `wetNights text: ${s}`);
    assert(s.includes('50%') && s.includes('3.5 wet nights per week'), `wetNights text: ${s}`);

    const small4 = textEquivalent(wetNights(allOf(small)));
    assert(small4.includes('2 wet of 4 nights reviewed'), `small text: ${small4}`);
    assert(small4.includes('Not enough recorded nights'), `small text: ${small4}`);
    assert(!small4.includes('%'), `a rate leaked below the threshold: ${small4}`);
    // Review-due nights are named once, inside the unreviewed clause.
    assert(small4.includes('1 night is not reviewed and excluded, including 1 with a wet event recorded'),
      `review-due wording: ${small4}`);
    assert(small4.match(/not reviewed/g).length === 1, `"not reviewed" counted twice: ${small4}`);

    const f = textEquivalent(firstWetting(allOf(large)));
    assert(f.includes('median 4 hours across 10 nights'), `firstWetting text: ${f}`);
    assert(f.includes('3 for no asleep time'), `firstWetting text: ${f}`);

    const c = textEquivalent(liftComparison(allOf(dst)));
    assert(c.includes('With a lift: 5 dry of 10 nights (50%)'), `lift text: ${c}`);
    assert(c.includes('not proof of cause'), `lift text has no caveat: ${c}`);

    const r = textEquivalent(routineComparison(dst, dst.experiments[0], new Date(2026, 10, 9, 20, 0)));
    assert(r.includes('Two equal windows of 15 nights'), `routine text: ${r}`);
    assert(r.includes('not proof of cause'), `routine text has no caveat: ${r}`);
    return 'Rates, denominators, exclusions and the caveat all present';
  });

  const failed = rows.filter(r => r.s === 'bad').length;
  rows.push(failed
    ? bad('Metrics self-tests', `${failed} of ${rows.length} failed`)
    : ok('Metrics self-tests', `${rows.length} checks passed`));
  return rows;
}
