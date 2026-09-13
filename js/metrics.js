// Every figure the Patterns screens show, computed here so no screen ever has
// to decide what counts. Pure — no DOM, no storage.
//
// Two rules run through the whole file, from UX-HANDOFF §P01–P03, which is
// stricter than DESIGN.md §5 and is what gets built:
//
//   1. Every result carries its own denominator and its excluded counts with
//      reasons. A figure that cannot say what it divided by is not shippable.
//   2. A percentage is only computed at 10 or more eligible records (per group
//      for a two-group comparison, 10 known-noticed events for arousal). Below
//      that the result sets `insufficient` and the counts stand alone, so the
//      screen shows "3 wet of 6 reviewed" rather than a trend claim.
//
// `null` in the document means nobody answered. `false`, `0` and `'none'` mean
// someone did. Every denominator here depends on telling those apart.

import { findNight, isReviewed, nightIdFor, parseIso, prevNightId, shiftDate } from './model.js';

export const MIN_ELIGIBLE = 10;

/* ── Small helpers ──────────────────────────────────────────────────── */

// Differences always go through parseIso().ms, never a wall-clock subtraction:
// across the October DST change 20:30 → 02:00 is 5.5 hours on both sides of it
// only if the stored offsets are honoured.
const msOf = iso => parseIso(iso)?.ms ?? null;

const round = (x, p = 2) => Math.round(x * 10 ** p) / 10 ** p;

const wetEvents = night => (night?.events ?? []).filter(e => e?.type === 'wet');

const outcomeOf = night => night?.morning?.outcome ?? null;

const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
};

// Date arithmetic in UTC — a local midnight can be skipped by a DST jump.
const dayNumber = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;

const nightsBetween = (fromId, toId) => dayNumber(toId) - dayNumber(fromId) + 1;

/* ── Range ──────────────────────────────────────────────────────────────
   A night stays open until 15:00 the following day — that is what
   nightIdFor does, and events logged at 10:00 still land in the night
   before. So the night the clock is currently inside is half-recorded by
   definition, and the last *completed* night is the one before it. */

const PERIODS = { '7d': 7, '28d': 28 };

export function lastCompletedNightId(today = new Date()) {
  return prevNightId(nightIdFor(today));
}

export function rangeFor(period, today = new Date()) {
  const length = PERIODS[period] ?? PERIODS['28d'];
  const toId = lastCompletedNightId(today);
  return { period: period in PERIODS ? period : '28d', length, fromId: shiftDate(toId, -(length - 1)), toId };
}

export function nightsInRange(doc, fromId, toId) {
  if (!fromId || !toId || fromId > toId) return [];
  const all = Array.isArray(doc?.nights) ? doc.nights : [];
  return all
    .filter(n => typeof n?.id === 'string' && n.id >= fromId && n.id <= toId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* ── Coverage ───────────────────────────────────────────────────────────
   Shown before any rate: a rate over 6 of 28 nights is a different object
   from the same rate over 26. */

export function coverage(nights) {
  let reviewed = 0;
  let wetRecordedReviewDue = 0;
  for (const n of nights) {
    if (isReviewed(n)) reviewed++;
    else if (wetEvents(n).length) wetRecordedReviewDue++;
  }
  return {
    kind: 'coverage',
    total: nights.length,
    reviewed,
    unreviewed: nights.length - reviewed,
    wetRecordedReviewDue,
  };
}

/* ── Wet nights ─────────────────────────────────────────────────────── */

// A wet event on an unreviewed night is "Wet recorded, review due": the event
// happened, but nobody confirmed the night's outcome, so it cannot join a
// finalised rate in either direction.
export function wetNights(nights) {
  let wet = 0;
  let dry = 0;
  let reviewDue = 0;
  for (const n of nights) {
    const outcome = outcomeOf(n);
    if (outcome === 'wet') wet++;
    else if (outcome === 'dry') dry++;
    else if (wetEvents(n).length) reviewDue++;
  }
  const reviewed = wet + dry;
  const unreviewed = nights.length - reviewed;
  const enough = reviewed >= MIN_ELIGIBLE;
  return {
    kind: 'wetNights',
    total: nights.length,
    wet,
    dry,
    reviewed,
    eligible: reviewed,
    unreviewed,
    // A subset of `unreviewed`, not a further exclusion: these are the nights
    // the screen names "Wet recorded, review due".
    excludedReviewDue: reviewDue,
    excluded: { unreviewed },
    rate: enough ? wet / reviewed : null,
    ratePerWeek: enough ? round((wet / reviewed) * 7) : null,
    insufficient: !enough,
  };
}

// Whole weeks counted backwards from `toId`, oldest first — the P01 bar
// series. Each bar carries its own reviewed count, because four bars over
// four different denominators are not comparable without it.
export function wetNightsByWeek(nights, toId, weeks = 4) {
  const out = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const wTo = shiftDate(toId, -7 * k);
    const wFrom = shiftDate(wTo, -6);
    let wet = 0;
    let reviewed = 0;
    for (const n of nights) {
      if (n.id < wFrom || n.id > wTo) continue;
      const outcome = outcomeOf(n);
      if (outcome === null) continue;
      reviewed++;
      if (outcome === 'wet') wet++;
    }
    out.push({ fromId: wFrom, toId: wTo, wet, reviewed });
  }
  return { kind: 'wetNightsByWeek', weeks: out };
}

/* ── Timing ─────────────────────────────────────────────────────────────
   Hours after falling asleep, never clock time: 02:00 means something
   different after a 19:30 bedtime than after a 21:30 one. */

export function firstWetting(nights) {
  const points = [];
  const excluded = { noAsleep: 0, noWet: 0, invalidOrder: 0 };
  for (const n of nights) {
    const wets = wetEvents(n);
    if (!wets.length) {
      // A confirmed wet night with no event detail has no timing to plot.
      // It is disclosed, not counted as a zero.
      if (outcomeOf(n) === 'wet') excluded.noWet++;
      continue;
    }
    const asleep = msOf(n?.evening?.asleepAt);
    if (asleep === null) { excluded.noAsleep++; continue; }
    const first = wets.reduce((a, b) => ((msOf(b.t) ?? Infinity) < (msOf(a.t) ?? Infinity) ? b : a));
    const t = msOf(first.t);
    if (t === null || t <= asleep) { excluded.invalidOrder++; continue; }
    points.push({ id: n.id, hours: round((t - asleep) / 3600000) });
  }
  return {
    kind: 'firstWetting',
    points,
    eligible: points.length,
    excluded,
    // A median describes the points that are drawn beside it, so it is not
    // suppressed below the threshold the way a projected rate is; the flag
    // tells the screen to state the sample rather than imply a trend.
    median: median(points.map(p => p.hours)),
    insufficient: points.length < MIN_ELIGIBLE,
  };
}

// Denominator is confirmed wet nights that have event detail. A wet outcome
// with no events is not zero wettings — it is missing detail, excluded and
// disclosed. Unreviewed nights are left out of both sides of the ratio.
export function wettingsPerWetNight(nights) {
  let events = 0;
  let detailed = 0;
  let noEvents = 0;
  let reviewDue = 0;
  for (const n of nights) {
    const count = wetEvents(n).length;
    if (outcomeOf(n) === 'wet') {
      if (count) { events += count; detailed++; } else noEvents++;
    } else if (outcomeOf(n) === null && count) reviewDue++;
  }
  return {
    kind: 'wettingsPerWetNight',
    events,
    nights: detailed,
    eligible: detailed,
    excludedNoEvents: noEvents,
    excluded: { noEvents, reviewDue },
    mean: detailed ? round(events / detailed) : null,
    insufficient: detailed < MIN_ELIGIBLE,
  };
}

/* ── Arousal and initiative ─────────────────────────────────────────── */

// Per-event, not per-night: the event's existence is the recorded fact, so an
// unreviewed night's wet event still carries a usable `noticed` answer. The
// denominator is events where somebody answered it; unknowns are reported
// alongside, never folded into "parent found it".
export function noticed(nights) {
  let self = 0;
  let parent = 0;
  let unknown = 0;
  for (const n of nights) {
    for (const ev of wetEvents(n)) {
      if (ev.noticed === 'self') self++;
      else if (ev.noticed === 'parent') parent++;
      else unknown++;
    }
  }
  const known = self + parent;
  const enough = known >= MIN_ELIGIBLE;
  return {
    kind: 'noticed',
    self,
    parent,
    unknown,
    known,
    events: known + unknown,
    eligible: known,
    excluded: { unknown },
    share: enough ? self / known : null,
    insufficient: !enough,
  };
}

// Kept independent of the outcome: asking to pee is the success behaviour
// whether or not the night stayed dry.
export function askedToPee(nights) {
  let reviewed = 0;
  let withSelfToilet = 0;
  for (const n of nights) {
    if (!isReviewed(n)) continue;
    reviewed++;
    if ((n.events ?? []).some(e => e?.type === 'selfToilet')) withSelfToilet++;
  }
  const unreviewed = nights.length - reviewed;
  const enough = reviewed >= MIN_ELIGIBLE;
  return {
    kind: 'askedToPee',
    nights: withSelfToilet,
    reviewed,
    eligible: reviewed,
    excluded: { unreviewed },
    share: enough ? withSelfToilet / reviewed : null,
    insufficient: !enough,
  };
}

/* ── Comparisons ────────────────────────────────────────────────────────
   All four share one shape. `classify` returns { group } or { excluded },
   and an unreviewed night is excluded before classification — without a
   confirmed outcome there is nothing to put on either side.

   `measure` names which count `rate` is: wet for drinks, timing and bowel,
   dry for lifts. Both counts are returned either way, so the screen never
   has to subtract. */

function compare({ metric, measure, groups: defs, classify, nights }) {
  const groups = defs.map(d => ({
    key: d.key, label: d.label, eligible: 0, wet: 0, dry: 0, rate: null, insufficient: true,
  }));
  const byKey = new Map(groups.map(g => [g.key, g]));
  const excluded = {};
  const drop = reason => { excluded[reason] = (excluded[reason] ?? 0) + 1; };

  for (const n of nights) {
    const outcome = outcomeOf(n);
    if (outcome !== 'wet' && outcome !== 'dry') { drop('reviewDue'); continue; }
    const verdict = classify(n);
    const group = verdict?.group ? byKey.get(verdict.group) : null;
    if (!group) { drop(verdict?.excluded ?? 'unknown'); continue; }
    group.eligible++;
    if (outcome === 'wet') group.wet++; else group.dry++;
  }

  let comparable = 0;
  for (const g of groups) {
    g.insufficient = g.eligible < MIN_ELIGIBLE;
    if (!g.insufficient) {
      comparable++;
      g.rate = (measure === 'dry' ? g.dry : g.wet) / g.eligible;
    }
  }

  return {
    kind: 'comparison',
    metric,
    measure,
    groups,
    eligible: groups.reduce((s, g) => s + g.eligible, 0),
    excluded,
    // Two groups have to clear the threshold before the difference between
    // them means anything; one alone is a number, not a comparison.
    insufficient: comparable < 2,
  };
}

const DRINK_GROUPS = [
  { key: 'none', label: 'None after dinner' },
  { key: 'sip', label: 'Sips only' },
  { key: 'cup+', label: 'A cup or more' },
];

// "No drinks" has to be the confirmed fact (noDrinks === true), never an empty
// array — an empty array is nobody having filled it in.
//
// A confirmed none does not need a dinner time: if there were no evening
// drinks at all then there were none after dinner, whenever dinner was. Only
// the nights that have drinks to place relative to dinner need dinnerAt.
function classifyDrinks(night) {
  const ev = night?.evening ?? {};
  const drinks = Array.isArray(ev.drinks) ? ev.drinks : [];
  if (ev.noDrinks === true) return { group: 'none' };
  if (!drinks.length) return { excluded: 'unknownDrinks' };
  const dinner = msOf(ev.dinnerAt);
  if (dinner === null) return { excluded: 'noDinner' };
  if (drinks.some(d => msOf(d?.at) === null)) return { excluded: 'unknownDrinkTime' };
  const post = drinks.filter(d => msOf(d.at) >= dinner);
  if (!post.length) return { group: 'none' };
  if (post.some(d => d.size === 'cup' || d.size === 'lots')) return { group: 'cup+' };
  if (post.some(d => (d.size ?? null) === null)) return { excluded: 'unknownDrinkSize' };
  return { group: 'sip' };
}

export function drinksComparison(nights) {
  return compare({
    metric: 'drinks', measure: 'wet', groups: DRINK_GROUPS, classify: classifyDrinks, nights,
  });
}

const TOILET_GROUPS = [
  { key: 'le30', label: '≤30 min' },
  { key: '31to60', label: '31–60 min' },
  { key: 'gt60', label: '> 60 min' },
];

function classifyLastToilet(night) {
  const ev = night?.evening ?? {};
  const toilet = msOf(ev.lastToiletAt);
  const asleep = msOf(ev.asleepAt);
  if (toilet === null || asleep === null) return { excluded: 'unknownTimes' };
  const mins = (asleep - toilet) / 60000;
  if (mins < 0) return { excluded: 'invalidOrder' };
  if (mins <= 30) return { group: 'le30' };
  if (mins <= 60) return { group: '31to60' };
  return { group: 'gt60' };
}

export function lastToiletComparison(nights) {
  return compare({
    metric: 'lastToilet', measure: 'wet', groups: TOILET_GROUPS, classify: classifyLastToilet, nights,
  });
}

const LIFT_GROUPS = [
  { key: 'lift', label: 'With a lift' },
  { key: 'noLift', label: 'No lift' },
];

// A lift event is positive evidence on its own. "No lift" is not: an empty
// event list can equally mean nobody logged anything, so that arm needs
// morning.eventsComplete === true before the night can join it.
function classifyLift(night) {
  if ((night?.events ?? []).some(e => e?.type === 'lift')) return { group: 'lift' };
  if (night?.morning?.eventsComplete === true) return { group: 'noLift' };
  return { excluded: 'incompleteRecord' };
}

export function liftComparison(nights) {
  return compare({
    metric: 'lift', measure: 'dry', groups: LIFT_GROUPS, classify: classifyLift, nights,
  });
}

const STOOL_GROUPS = [
  { key: 'none', label: 'None' },
  { key: 'hard', label: 'Hard' },
  { key: 'normal', label: 'Normal' },
  { key: 'loose', label: 'Loose' },
];

export function bowelComparison(nights, doc) {
  // night.day describes the day AFTER that night, so the daytime preceding
  // night N is night N−1's `day`. Getting this off by one is the easiest
  // mistake in the file; the self-test asserts it against both neighbours.
  const classify = night => {
    const previous = findNight(doc, prevNightId(night.id));
    const stool = previous?.day?.stool ?? null;
    return stool === null ? { excluded: 'noRecord' } : { group: stool };
  };
  return compare({
    metric: 'bowel', measure: 'wet', groups: STOOL_GROUPS, classify, nights,
  });
}

/* ── Routines ───────────────────────────────────────────────────────────
   Equal-length Before / During windows in completed nights. Missing nights
   stay missing — the before window is never stretched to collect more
   records, because that is the one thing that would make the two sides
   incomparable. */

const emptyWindow = (fromId, toId) => ({ fromId, toId, ...wetNights([]) });

export function routineComparison(doc, experiment, today = new Date()) {
  const last = lastCompletedNightId(today);
  const from = experiment?.from ?? null;
  const end = experiment?.to ?? null;
  // An ongoing routine uses elapsed completed nights only; an ended one stops
  // at its own last evening.
  const duringTo = end && end < last ? end : last;

  if (!from || !duringTo || duringTo < from) {
    return {
      kind: 'routineComparison',
      windowNights: 0,
      before: emptyWindow(null, null),
      during: emptyWindow(from, null),
      insufficient: true,
    };
  }

  const windowNights = nightsBetween(from, duringTo);
  const beforeTo = prevNightId(from);
  const beforeFrom = shiftDate(beforeTo, -(windowNights - 1));
  const during = { fromId: from, toId: duringTo, ...wetNights(nightsInRange(doc, from, duringTo)) };
  const before = { fromId: beforeFrom, toId: beforeTo, ...wetNights(nightsInRange(doc, beforeFrom, beforeTo)) };

  return {
    kind: 'routineComparison',
    windowNights,
    before,
    during,
    insufficient: before.reviewed < MIN_ELIGIBLE || during.reviewed < MIN_ELIGIBLE,
  };
}
