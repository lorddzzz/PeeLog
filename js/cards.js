// R01 evening, R02 morning, R03 following day (IMPLEMENTATION.md §2). R02 no
// longer records an outcome: nightStatus derives it from the night's own
// record, so the card asks only what nothing else can tell it.

import {
  DAY_FIELDS, EVENING_FIELDS, MORNING_FIELDS, activeExperiment, addDrink,
  dayDateFor, dayLabelFor, daysSince, ensureNight, findDrink, findNight,
  isReviewed, newDrink, nightIdFor, openNight, removeDrink,
  setNoDrinks, suggestedEveningTimes, timeLabelFor, toggleSleepSign,
  weekdayNameFor,
} from './model.js';
import {
  button, checkbox, chipGroup, h, icon, notice, paint, stepper, textField,
  timeField, title,
} from './ui.js';

const NOT_SAVED = 'There isn’t enough space to save this. Keep this screen open and try again.';

/* ── Shared "quiet Saved line / S01 retry" strip ───────────────────────────
   The same feedback shape as the event detail panel in tonight.js: a line
   that is always in the layout (so nothing jumps), lit up on a successful
   write, replaced by an explicit retry notice on a failed one — never a
   checkmark for a write that did not happen. */

function detailNote(cardState) {
  if (cardState.failure) {
    return notice({
      kind: 'error',
      title: 'Not saved',
      text: NOT_SAVED,
      children: [button({ label: 'Retry saving', k: 'retry', onClick: cardState.failure.retry })],
    });
  }
  return h('p', { class: `saved-note${cardState.note ? '' : ' quiet'}` },
    icon('check'), h('span', { text: cardState.note || 'Saved' }));
}

// Every screen's writes go through this: same success/failure shape, so
// detailNote above is the one place that feedback is drawn.
function writeDetail(ctx, mutate, cardState, draw) {
  const result = ctx.store.update(mutate);
  if (!result.ok) {
    cardState.failure = { retry: () => writeDetail(ctx, mutate, cardState, draw) };
    cardState.note = '';
    draw();
    return;
  }
  cardState.failure = null;
  cardState.note = 'Saved';
  draw();
}

/* ── Morning (R02) ──────────────────────────────────────────────────── */

const state = {
  nightId: null,
  note: '',
  failure: null,
};

function reset(nightId) {
  state.nightId = nightId;
  state.note = '';
  state.failure = null;
  nudge.later = false;
}

/* ── Writes ─────────────────────────────────────────────────────────────
   ensureNight, never openNight: a morning review does not reopen the night
   for logging, so activeNightId is left exactly where it was. */

// The morning fields never reopen the night for logging either.
function writeMorningDetail(ctx, fn, draw) {
  writeDetail(ctx, draft => fn(ensureNight(draft, state.nightId).morning), state, draw);
}

export function renderMorning(el, ctx) {
  reset(ctx.params.nightId);
  const draw = () => paint(el, morning(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function morning(ctx, draw) {
  const id = state.nightId;
  // The night may not exist yet — it is created on the first write, not on
  // view, so a stranger's link or a fresh id must still render normally.
  const night = findNight(ctx.store.get(), id);
  const wetEvents = (night?.events ?? []).filter(e => e.type === 'wet');
  const m = night?.morning ?? { wakeAt: null, mood: null, sleepSigns: null, eventsComplete: null, note: '' };

  return [
    title({
      overline: dayLabelFor(dayDateFor(id)),
      name: 'Morning check-in',
      lead: 'How was the night?',
    }),
    h('p', { class: 'context', text: wetEvents.length ? wetContextLine(wetEvents) : outcomeLine(night) }),
    // Woke at leads the card: with no wet entry it is the whole difference
    // between a dry night and one nobody was there for (DESIGN.md §4.1).
    timeField({
      label: 'Woke at', value: m.wakeAt, dates: dayDateFor(id), k: 'wake',
      onCommit: iso => writeMorningDetail(ctx, morn => { morn.wakeAt = iso; }, draw),
    }),
    chipGroup({
      label: MORNING_FIELDS.mood.label, name: 'mood', options: MORNING_FIELDS.mood.options, value: m.mood,
      onChange: v => writeMorningDetail(ctx, morn => { morn.mood = v; }, draw),
    }),
    chipGroup({
      label: MORNING_FIELDS.sleepSigns.label, name: 'sleep-signs', options: MORNING_FIELDS.sleepSigns.options,
      value: m.sleepSigns, multi: true, reduce: toggleSleepSign,
      onChange: v => writeMorningDetail(ctx, morn => { morn.sleepSigns = v; }, draw),
    }),
    chipGroup({
      label: 'Nighttime record', name: 'events-complete',
      options: [{ value: true, label: 'Night events complete' }], value: m.eventsComplete,
      onChange: v => writeMorningDetail(ctx, morn => { morn.eventsComplete = v; }, draw),
    }),
    textField({
      label: 'Note', value: m.note, k: 'morning-note',
      onCommit: text => writeMorningDetail(ctx, morn => { morn.note = text; }, draw),
    }),
    detailNote(state),
    // DESIGN.md §9.3 puts the Sunday nudge after the outcome is known, never
    // in front of the fields that make it knowable.
    isReviewed(night) ? backupNudge(ctx, draw) : null,
    button({ label: 'Done', k: 'done', kind: 'primary', onClick: () => ctx.back() }),
  ];
}

// What the record already says, so the card never reads as if it were still
// asking. Only reached when there is no wet entry to describe instead.
function outcomeLine(night) {
  return isReviewed(night)
    ? 'No wet-bed entry recorded · this night reads as dry'
    : 'No wet-bed entry recorded · add a wake time and this night reads as dry';
}

function wetContextLine(events) {
  const first = timeLabelFor(events[0].t);
  return events.length === 1
    ? `1 wet-bed entry recorded at ${first}`
    : `${events.length} wet-bed entries recorded · first at ${first}`;
}

// DESIGN.md §9.3: one quiet Sunday offer, dismissible for this visit. A
// backup nobody has confirmed saving counts as none. Exported: Tonight's day
// phase shows the same nudge once the night's outcome is known.
const nudge = { later: false };

export function backupNudge(ctx, draw) {
  if (nudge.later) return null;
  const now = ctx.now();
  if (now.getDay() !== 0) return null;
  const doc = ctx.store.get();
  if (!doc.nights.length) return null;
  const days = daysSince(doc.settings?.lastBackupConfirmedAt ?? null, now);
  if (days !== null && days <= 7) return null;

  return notice({
    kind: 'warm',
    title: 'A separate copy, just in case.',
    text: days === null
      ? 'No backup has been saved from this phone yet.'
      : `It’s been ${days} days since your last backup.`,
    children: [
      button({ label: 'Back up now', href: '#/more/backup', k: 'backup-now' }),
      button({
        label: 'Later', kind: 'quiet', k: 'backup-later',
        onClick: () => { nudge.later = true; draw(); },
      }),
    ],
  });
}

/* ── Evening (R01) ──────────────────────────────────────────────────────
   A write opens the night only when it is the night the clock is in now:
   editing a past evening from History must not drag activeNightId backwards,
   or Tonight would nag about a night that is already done. A mere visit never
   writes, so viewing this card alone never moves activeNightId. */

const eveningState = { nightId: null, note: '', failure: null };

function resetEvening(nightId) {
  eveningState.nightId = nightId;
  eveningState.note = '';
  eveningState.failure = null;
}

function writeEvening(ctx, fn, draw) {
  const id = eveningState.nightId;
  const open = id === nightIdFor(ctx.now()) ? openNight : ensureNight;
  writeDetail(ctx, draft => fn(open(draft, id)), eveningState, draw);
}

export function renderEvening(el, ctx) {
  resetEvening(ctx.params.nightId);
  const draw = () => paint(el, evening(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function evening(ctx, draw) {
  const id = eveningState.nightId;
  const doc = ctx.store.get();
  const night = findNight(doc, id);
  const ev = night?.evening ?? { drinks: [], dayContext: [] };
  const dates = [id, dayDateFor(id)];
  const suggested = suggestedEveningTimes(doc, id);

  return [
    title({
      overline: dayLabelFor(id),
      name: 'Evening',
      lead: 'Before the night starts. Everything here can wait.',
    }),
    timeField({
      label: 'Dinner', value: ev.dinnerAt, dates, k: 'dinner', suggested: suggested.dinnerAt,
      onCommit: iso => writeEvening(ctx, n => { n.evening.dinnerAt = iso; }, draw),
    }),
    h('h3', { text: 'Evening drinks' }),
    ev.drinks.map((drink, i) => drinkRow(ctx, id, dates, drink, i, draw)),
    button({
      label: '+ Add drink', k: 'add-drink',
      onClick: () => writeEvening(ctx, n => addDrink(n.evening, newDrink()), draw),
    }),
    chipGroup({
      label: 'Or confirm', name: 'no-drinks', options: [{ value: true, label: 'No evening drinks' }],
      value: ev.noDrinks,
      onChange: v => writeEvening(ctx, n => setNoDrinks(n.evening, v), draw),
    }),
    h('h3', { text: 'Last toilet' }),
    timeField({
      label: 'Time', value: ev.lastToiletAt, dates, k: 'last-toilet',
      onCommit: iso => writeEvening(ctx, n => { n.evening.lastToiletAt = iso; }, draw),
    }),
    chipGroup({
      label: 'How much?', name: 'last-toilet-output', options: EVENING_FIELDS.lastToiletOutput.options,
      value: ev.lastToiletOutput,
      onChange: v => writeEvening(ctx, n => { n.evening.lastToiletOutput = v; }, draw),
    }),
    h('h3', { text: 'Sleep' }),
    timeField({
      label: 'Lights out', value: ev.lightsOutAt, dates, k: 'lights-out', suggested: suggested.lightsOutAt,
      onCommit: iso => writeEvening(ctx, n => { n.evening.lightsOutAt = iso; }, draw),
    }),
    timeField({
      label: 'Fell asleep', value: ev.asleepAt, dates, k: 'asleep', suggested: suggested.asleepAt,
      onCommit: iso => writeEvening(ctx, n => { n.evening.asleepAt = iso; }, draw),
    }),
    checkbox({
      label: 'Estimated', checked: !!ev.asleepEstimated, k: 'asleep-estimated',
      onChange: v => writeEvening(ctx, n => { n.evening.asleepEstimated = v; }, draw),
    }),
    chipGroup({
      label: EVENING_FIELDS.dayContext.label, name: 'day-context', options: EVENING_FIELDS.dayContext.options,
      value: ev.dayContext, multi: true,
      onChange: v => writeEvening(ctx, n => { n.evening.dayContext = v; }, draw),
    }),
    textField({
      label: 'Note', value: ev.note, k: 'evening-note',
      onCommit: text => writeEvening(ctx, n => { n.evening.note = text; }, draw),
    }),
    routineRow(doc, night, id),
    detailNote(eveningState),
    button({ label: 'Done', k: 'done', kind: 'primary', onClick: () => ctx.back() }),
  ];
}

function drinkRow(ctx, id, dates, drink, index, draw) {
  return h('div', { class: 'drink-row' },
    h('div', { class: 'drink-row-head' },
      h('span', { class: 'field-label', text: `Drink ${index + 1}` }),
      h('button', {
        class: 'chip', type: 'button', k: `drink-remove-${drink.id}`,
        'on:click': () => writeEvening(ctx, n => { removeDrink(n.evening, drink.id); }, draw),
      }, icon('close'), 'Remove')),
    timeField({
      label: 'Time', value: drink.at, dates, k: `drink-time-${drink.id}`,
      onCommit: iso => writeEvening(ctx, n => {
        const d = findDrink(n.evening, drink.id);
        if (d) d.at = iso;
      }, draw),
    }),
    chipGroup({
      label: 'Amount', name: `drink-size-${drink.id}`, options: EVENING_FIELDS.drinkSize.options, value: drink.size,
      onChange: v => writeEvening(ctx, n => {
        const d = findDrink(n.evening, drink.id);
        if (d) d.size = v;
      }, draw),
    }));
}

// The routine this evening belongs to (R01), named and nothing more — no
// advice, and no link off to Routines from the middle of an evening. A night
// recorded before its routine started carries no tag, so the dates are asked
// for as well — the answer is the same one night creation used.
function routineRow(doc, night, nightId) {
  const tagged = night?.experimentId ?? null;
  const exp = (tagged ? doc.experiments.find(e => e.id === tagged) : null)
    ?? activeExperiment(doc, night?.id ?? nightId ?? null);
  if (!exp) return null;
  const when = exp.to
    ? `${dayLabelFor(exp.from)} – ${dayLabelFor(exp.to)}`
    : `since ${dayLabelFor(exp.from)}`;
  return h('p', { class: 'small', k: 'routine', text: `Routine: ${exp.name} · ${when}` });
}

/* ── Following day (R03) ────────────────────────────────────────────────
   ensureNight, not openNight: filling in yesterday's daytime must never
   move tonight's activeNightId. */

const dayState = { nightId: null, note: '', failure: null };

function resetDay(nightId) {
  dayState.nightId = nightId;
  dayState.note = '';
  dayState.failure = null;
}

function writeDay(ctx, fn, draw) {
  writeDetail(ctx, draft => fn(ensureNight(draft, dayState.nightId)), dayState, draw);
}

export function renderDay(el, ctx) {
  resetDay(ctx.params.nightId);
  const draw = () => paint(el, day(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function day(ctx, draw) {
  const id = dayState.nightId;
  const night = findNight(ctx.store.get(), id);
  const d = night?.day ?? { accidents: null, stool: null };
  const dayDate = dayDateFor(id);

  return [
    title({
      overline: `${weekdayNameFor(dayDate)} daytime · following ${weekdayNameFor(id)} night`,
      name: 'The day after',
      lead: 'Daytime notes for the day after this night, kept separate from the night itself.',
    }),
    stepper({
      label: DAY_FIELDS.accidents.label, value: d.accidents, min: 0,
      onChange: v => writeDay(ctx, n => { n.day.accidents = v; }, draw),
    }),
    chipGroup({
      label: DAY_FIELDS.stool.label, name: 'stool', options: DAY_FIELDS.stool.options, value: d.stool,
      onChange: v => writeDay(ctx, n => { n.day.stool = v; }, draw),
    }),
    detailNote(dayState),
    button({ label: 'Done', k: 'done', kind: 'primary', onClick: () => ctx.back() }),
  ];
}
