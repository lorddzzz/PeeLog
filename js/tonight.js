// T01–T02 and E01–E05, on one grid in three phases (DESIGN.md §4.1). The
// first tap writes (AGENTS.md rule 6): nothing on this screen may put a
// form, a confirm or a timer in front of it, and nothing says Saved before
// store.update returns ok. The phase — evening, night, day — is read off the
// night's own record, so the screen and the data can never disagree.

import {
  DAY_FIELDS, EVENING_FIELDS, EVENT_ORDER, EVENT_TYPES, MORNING_FIELDS, PHASES,
  activeNightFor, addDrink, dayDateFor, dayLabelFor, dayOwnerId, ensureNight,
  findDrink, findEvent, findNight, insertEvent, isReviewed, latestEvent,
  moveEventTo, newDrink, newEvent, nightForEvent, nightIdFor, nightIdForIso,
  nightStatus, openNight, pendingReviewFor, phaseFor, setNoDrinks,
  stampLabelFor, timeLabelFor, toIso, toggleSleepSign, undoAction,
  weekdayNameFor,
} from './model.js';
import {
  button, checkbox, chipGroup, dateTimeField, h, icon, linkRow, notice, paint,
  savedStrip, stepper, timeField, title,
} from './ui.js';
import { backupNudge } from './cards.js';

/* ── Screen copy ────────────────────────────────────────────────────────
   The questions come from the atlas studies (docs/ux/screens.js E01–E05).
   model.js carries the handoff's table names for the same fields — those are
   the column headings for history rows and exports; at 3am the question form
   reads better, so the screen keeps its own wording. */

// Exported: History's edit draft (H04) asks the same questions of the same
// fields, and two copies of this table would drift apart.
export const FIELD_COPY = {
  'wet.amount': 'How much?',
  'wet.noticed': 'Who noticed?',
  'wet.changed': 'What changed?',
  'selfToilet.output': 'How much?',
  'selfToilet.madeIt': 'Made it to the toilet?',
  'lift.output': 'How much?',
  'lift.woke': 'Did she wake during the lift?',
  'drink.size': 'How much?',
  'wake.note': 'Anything you want to remember?',
};

const ACTION_HINT = {
  selfToilet: 'On her own',
  lift: 'To the toilet',
  drink: 'Had a drink',
  wake: 'For another reason',
  wet: 'Details can wait.',
};

const NOT_SAVED = 'There isn’t enough space to save this entry. Keep this screen open and try again.';
const BLANK_OK = 'You can leave these blank and come back later.';

const PHASE_LABEL = { evening: 'Evening', night: 'Night', day: 'Day' };
const PHASE_LEAD = {
  evening: 'Before the night. Everything can wait.',
  night: 'One tap. Back to rest.',
  day: 'How was the night?',
};

/* ── Steps ──────────────────────────────────────────────────────────────
   The evening and the morning are logged the way the night is: one tap
   stamps now into the field the cards used to ask for (evening.dinnerAt,
   morning.wakeAt …), so nothing about the stored record changed. Detail is
   optional enrichment in the panel below, exactly like an event. A step
   already stamped opens its panel instead of stamping again — except Last
   toilet, which is the *last* one by definition, so a later tap replaces it
   (with Undo). Drink is a row per tap, like the evening card's list. */

const STEPS = {
  dinner: { label: 'Dinner', hint: 'Finished eating', icon: 'dinner', block: 'evening', key: 'dinnerAt' },
  drink: { label: 'Drink', hint: 'An evening drink', icon: 'water' },
  lastToilet: { label: 'Last toilet', hint: 'Before bed', icon: 'toilet', block: 'evening', key: 'lastToiletAt', restamp: true },
  lightsOut: { label: 'Lights out', hint: 'Bedtime', icon: 'moon', block: 'evening', key: 'lightsOutAt' },
  asleep: { label: 'Fell asleep', hint: 'The night begins', icon: 'bed', block: 'evening', key: 'asleepAt', transition: true },
  wake: { label: 'She’s up', hint: 'The morning begins', icon: 'sun', block: 'morning', key: 'wakeAt', transition: true },
};

/* ── Screen state ───────────────────────────────────────────────────────
   Kept at module level so a re-render from store.subscribe cannot close an
   open detail panel. Navigation resets `state`; `visit` outlives it — Undo
   has to still be there after a glance at History, and the phase pill was
   chosen for this visit, not this render. Neither survives a relaunch. */

const state = {
  open: null,          // { kind: 'event', id } | { kind: 'step', key } | { kind: 'drink', id }
  editingTime: false,  // event panel: the date+time field is showing
  panelNote: '',       // quiet "Saved" inside the panel
  panelError: '',
  moveNote: '',
  failure: null,       // { label, retry } — the tap that did not save
  undoError: '',
  suppress: false,     // a write that must not rebuild the panel; see quietWrite
};

const visit = {
  last: null,          // the last tap, for Undo — see undoAction in model.js
  phase: null,         // the pill's choice; a transition tap clears it
};

function reset() {
  state.open = null;
  state.editingTime = false;
  state.panelNote = '';
  state.panelError = '';
  state.moveNote = '';
  state.failure = null;
  state.undoError = '';
}

function openPanel(open) {
  state.open = open;
  state.editingTime = false;
  state.panelNote = '';
  state.panelError = '';
  state.moveNote = '';
}

/* ── Which night ────────────────────────────────────────────────────────
   Evening steps and night events belong to the night the clock is in.
   The morning — She's up, the outcome, stool, accidents — belongs to the
   night being reviewed: the clock's night while it is still night or once
   She's up has been stamped on it, otherwise the night whose day-after is
   today (dayOwnerId). That is what makes a 17:00 stool land on last night
   rather than on the evening that has just begun, and keeps a She's up
   tapped before midnight reviewing the night it ended. */

function targets(ctx) {
  const now = ctx.now();
  const doc = ctx.store.get();
  const active = activeNightFor(doc, now);
  const night = findNight(doc, active.id);
  const phase = visit.phase ?? phaseFor(night, now);
  const woke = (night?.morning?.wakeAt ?? null) !== null;
  const reviewId = phase === 'night' || woke ? active.id : dayOwnerId(now);
  return {
    now, doc, phase,
    nightId: active.id, night,
    stale: active.stale ?? pendingReviewFor(doc, active.id),
    reviewId, review: findNight(doc, reviewId),
  };
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

function failed(label, retry, draw) {
  state.failure = { label, retry };
  draw();
}

// One tap, one event. The night is opened by the same write, so the first tap
// of the evening never needs a second one.
function logEvent(ctx, type, draw, { at, onLogged } = {}) {
  const now = ctx.now();
  const t = at ?? toIso(now);
  // The event's own timestamp decides its night, never whichever night happens
  // to be open: a retry that crosses 15:00 keeps the night it happened in, and
  // a device clock that once ran fast cannot pull tonight into a future night.
  const tonightId = nightIdFor(now);
  const id = nightIdForIso(t) ?? tonightId;
  let created = null;

  const result = ctx.store.update(draft => {
    // Only a tap that belongs to tonight opens a night for logging; filing a
    // late retry into an earlier one must not move activeNightId backwards.
    const night = id === tonightId ? openNight(draft, id) : ensureNight(draft, id);
    created = insertEvent(night, newEvent(type, t)).id;
  });

  if (!result.ok) {
    // The retry keeps the original timestamp: the event happened then, not
    // when the storage finally accepted it.
    failed(`${EVENT_TYPES[type].label} at ${timeLabelFor(t)}`, () => logEvent(ctx, type, draw, { at: t, onLogged }), draw);
    return;
  }
  state.failure = null;
  state.undoError = '';
  visit.last = { kind: 'event', id: created, nightId: id, label: EVENT_TYPES[type].label, at: t };
  openPanel({ kind: 'event', id: created });
  if (onLogged) onLogged(created);
  else draw();
}

// A step stamps now into its field. `at` is the original instant on a retry.
function stamp(ctx, step, draw, at = null) {
  const def = STEPS[step];
  const { now, nightId, reviewId } = targets(ctx);
  const id = def.block === 'morning' ? reviewId : nightId;
  const t = at ?? toIso(now);
  let prev = null;
  const result = ctx.store.update(draft => {
    // The evening opens the night for logging like an event does; the
    // morning never moves activeNightId (it is a review, not a night).
    const night = def.block === 'morning' ? ensureNight(draft, id) : openNight(draft, id);
    prev = night[def.block][def.key] ?? null;
    night[def.block][def.key] = t;
  });
  if (!result.ok) {
    failed(`${def.label} at ${timeLabelFor(t)}`, () => stamp(ctx, step, draw, t), draw);
    return;
  }
  state.failure = null;
  state.undoError = '';
  visit.last = { kind: 'field', nightId: id, block: def.block, key: def.key, prev, value: t, label: def.label, step, at: t };
  // The record now says which phase this is; a pill choice would only argue.
  if (def.transition) visit.phase = null;
  openPanel({ kind: 'step', key: step });
  draw();
}

function tapStep(ctx, step, draw) {
  const def = STEPS[step];
  if (step === 'drink') { logDrink(ctx, draw); return; }
  const { night, review } = targets(ctx);
  const owner = def.block === 'morning' ? review : night;
  const stamped = (owner?.[def.block]?.[def.key] ?? null) !== null;
  if (stamped && !def.restamp) { openPanel({ kind: 'step', key: step }); draw(); return; }
  stamp(ctx, step, draw);
}

function logDrink(ctx, draw, at = null) {
  const { now, nightId } = targets(ctx);
  const t = at ?? toIso(now);
  const drink = newDrink(t, null);
  let prevNoDrinks = null;
  const result = ctx.store.update(draft => {
    const evening = openNight(draft, nightId).evening;
    prevNoDrinks = evening.noDrinks ?? null;
    addDrink(evening, drink);
  });
  if (!result.ok) {
    failed(`Drink at ${timeLabelFor(t)}`, () => logDrink(ctx, draw, t), draw);
    return;
  }
  state.failure = null;
  state.undoError = '';
  visit.last = { kind: 'drink', nightId, id: drink.id, prevNoDrinks, label: 'Drink', at: t };
  openPanel({ kind: 'drink', id: drink.id });
  draw();
}

// The day rows — stool, accidents — write one value each and go straight
// onto the Undo strip; they have no panel of their own.
function writeReview(ctx, { block, key, value, label, text }, draw) {
  const { reviewId } = targets(ctx);
  let prev = null;
  const result = ctx.store.update(draft => {
    const night = ensureNight(draft, reviewId);
    prev = night[block][key] ?? null;
    night[block][key] = value;
  });
  if (!result.ok) {
    failed(label, () => writeReview(ctx, { block, key, value, label, text }, draw), draw);
    return;
  }
  state.failure = null;
  state.undoError = '';
  visit.last = { kind: 'field', nightId: reviewId, block, key, prev, value, label, text };
  draw();
}

// A panel's chips: they enrich the entry Undo already covers, so they only
// light the panel's own Saved line.
function panelWrite(ctx, mutate, draw) {
  const result = ctx.store.update(mutate);
  state.panelError = result.ok ? '' : NOT_SAVED;
  state.panelNote = result.ok ? 'Saved' : '';
  draw();
}

// A note commits on blur — which happens while the finger is still on Done.
// Rebuilding the panel there swallows that tap, so a successful text write
// only lights up the Saved line, which is always in the layout already.
function quietWrite(ctx, mutate, draw, box) {
  state.suppress = true;
  const result = ctx.store.update(mutate);
  state.suppress = false;
  if (!result.ok) {
    state.panelError = NOT_SAVED;
    state.panelNote = '';
    draw();
    return;
  }
  // A "Not saved" notice sits where the Saved line would be, so a write that
  // succeeds after a failed one has to redraw — the finger that is still on
  // Done was over the notice, not over the button.
  const hadError = !!state.panelError;
  state.panelError = '';
  state.panelNote = 'Saved';
  if (hadError) { draw(); return; }
  box.closest('.detail')?.querySelector('.saved-note')?.classList.remove('quiet');
}

function writeEventField(ctx, event, key, value) {
  return ctx.store.update(draft => {
    const found = findEvent(nightForEvent(draft, event.id), event.id);
    if (found) found[key] = value;
  });
}

// An edited timestamp moves the event, and may move it to another night.
function moveEvent(ctx, event, t, draw) {
  const to = nightIdForIso(t);
  const moved = to !== nightIdForIso(event.t);
  // Where a moved entry lands, and what becomes of the night it left, is one
  // rule in model.js — History's edit draft moves events too (H04).
  const result = ctx.store.update(draft => { moveEventTo(draft, event.id, t); });
  if (!result.ok) {
    state.panelError = NOT_SAVED;
    draw();
    return;
  }
  state.panelError = '';
  state.editingTime = false;
  state.panelNote = moved ? '' : 'Saved';
  state.moveNote = moved ? `Moved to the night of ${dayLabelFor(to)}.` : '';
  draw();
}

/* ── Undo ───────────────────────────────────────────────────────────────
   The strip undoes the last tap of this visit. With nothing tapped this
   visit — a relaunch — it falls back to what it always offered: removing
   the latest event of the night. */

function liveLast(ctx) {
  const { doc, nightId, night } = targets(ctx);
  const last = visit.last;
  if (last) {
    const alive = last.kind === 'event' ? !!findEvent(nightForEvent(doc, last.id), last.id)
      : last.kind === 'drink' ? !!findDrink(findNight(doc, last.nightId)?.evening ?? { drinks: [] }, last.id)
        : JSON.stringify(findNight(doc, last.nightId)?.[last.block]?.[last.key] ?? null) === JSON.stringify(last.value ?? null);
    if (alive) return last;
    visit.last = null;
  }
  const latest = latestEvent(night);
  return latest
    ? { kind: 'event', id: latest.id, nightId, label: EVENT_TYPES[latest.type].label, at: latest.t }
    : null;
}

function describe(last) {
  if (last.at) return `${last.label} · ${timeLabelFor(last.at)}`;
  if (last.text !== undefined) return `${last.label} · ${last.text}`;
  return last.label;
}

function panelFor(last) {
  if (last.kind === 'event') return { kind: 'event', id: last.id };
  if (last.kind === 'drink') return { kind: 'drink', id: last.id };
  if (last.step) return { kind: 'step', key: last.step };
  return null;
}

function undo(ctx, last, draw) {
  const result = ctx.store.update(draft => {
    if (!undoAction(draft, last)) throw new Error('nothing to undo');
  });
  if (!result.ok) {
    state.undoError = `Undo did not save · ${describe(last)}`;
    draw();
    return;
  }
  state.undoError = '';
  if (visit.last === last) visit.last = null;
  const panel = panelFor(last);
  if (panel && state.open && state.open.kind === panel.kind && (state.open.id ?? state.open.key) === (panel.id ?? panel.key)) {
    state.open = null;
    state.editingTime = false;
  }
  state.panelNote = '';
  state.moveNote = '';
  draw();
}

/* ── Tonight ────────────────────────────────────────────────────────────── */

export function render(el, ctx) {
  reset();
  const draw = () => { if (!state.suppress) paint(el, tonight(ctx, draw)); };
  draw();
  return ctx.store.subscribe(draw);
}

function tonight(ctx, draw) {
  const t = targets(ctx);
  const { doc, phase, nightId, night, reviewId, review, stale } = t;
  const open = openNode(ctx, draw);
  const last = liveLast(ctx);
  const recordId = phase === 'day' ? reviewId : nightId;

  return [
    header(phase, phase === 'day' ? reviewId : nightId),
    phasePill(phase, draw),
    stale && stale !== reviewId ? staleNotice(stale) : null,
    stale && stale === reviewId && phase !== 'day' ? staleSwitch(stale, draw) : null,
    h('p', { class: 'context', text: contextLine(t) }),
    grid(ctx, t, draw),
    state.failure ? failureNotice(draw) : null,
    last
      ? savedStrip({
        text: describe(last),
        detail: panelFor(last) ? (isOpen(panelFor(last)) ? 'Saved · details below' : 'Saved · tap for detail') : 'Saved',
        onOpen: panelFor(last) ? () => { openPanel(panelFor(last)); draw(); } : undefined,
        onUndo: () => undo(ctx, last, draw),
      })
      : savedStrip({ text: 'Nothing logged yet', detail: 'Ready whenever you need it.' }),
    state.undoError ? notice({ kind: 'error', title: state.undoError, text: 'The entry is still recorded. Try Undo again.' }) : null,
    state.moveNote ? notice({ text: state.moveNote }) : null,
    open,
    phase === 'day' && isReviewed(review) ? backupNudge(ctx, draw) : null,
    findNight(doc, recordId)
      ? linkRow({ label: 'This night’s record', sub: 'Everything recorded, and where to correct it', href: `#/night/${recordId}`, k: 'record' })
      : null,
  ];
}

const isOpen = panel => !!state.open && state.open.kind === panel.kind
  && (state.open.id ?? state.open.key) === (panel.id ?? panel.key);

function header(phase, nightId) {
  // Decoration only: hidden by body.no-art without moving a single control.
  const art = h('img', { class: 'art', src: 'assets/art/bedtime-moon.jpg', alt: '' });
  return h('div', { class: 'title-art' }, art,
    h('div', {}, title({
      overline: phase === 'day' ? `Night of ${dayLabelFor(nightId)}` : dayLabelFor(nightId),
      name: 'Tonight',
      lead: PHASE_LEAD[phase],
    })));
}

// Shows the phase the record puts the screen in, and switches it for this
// visit: a night event at 21:00 before anyone tapped Fell asleep, or last
// night's review at 16:00, are one tap away instead of a form away.
function phasePill(phase, draw) {
  return h('div', { class: 'chips phase', role: 'group', 'aria-label': 'Phase' }, PHASES.map(p =>
    h('button', {
      class: `chip${p === phase ? ' selected' : ''}`,
      type: 'button',
      k: `phase-${p}`,
      'aria-pressed': p === phase ? 'true' : 'false',
      'on:click': () => { visit.phase = p; draw(); },
    }, PHASE_LABEL[p])));
}

// Never infer a dry night from an empty list (handoff T01).
function contextLine({ phase, night, review }) {
  const count = night?.events?.length ?? 0;
  const events = count ? `${count} event${count > 1 ? 's' : ''}` : 'no events';
  if (phase === 'evening') {
    const ev = night?.evening;
    const parts = [];
    if (ev?.dinnerAt) parts.push(`Dinner ${timeLabelFor(ev.dinnerAt)}`);
    if (ev?.noDrinks) parts.push('no drinks');
    else if (ev?.drinks?.length) parts.push(`${ev.drinks.length} drink${ev.drinks.length > 1 ? 's' : ''}`);
    if (ev?.lastToiletAt) parts.push(`last toilet ${timeLabelFor(ev.lastToiletAt)}`);
    if (ev?.lightsOutAt) parts.push(`lights out ${timeLabelFor(ev.lightsOutAt)}`);
    return parts.length ? parts.join(' · ') : 'Nothing logged yet this evening';
  }
  if (phase === 'night') {
    const asleep = night?.evening?.asleepAt ?? null;
    return `${asleep ? `Asleep at ${timeLabelFor(asleep)}` : 'Sleep time not added'} · ${events}`;
  }
  const status = nightStatus(review);
  const wake = review?.morning?.wakeAt ?? null;
  const rc = review?.events?.length ?? 0;
  return [
    status === 'dry' ? 'Dry night' : status === 'wet' ? 'Wet night' : 'Nobody has been up yet',
    wake ? `up at ${timeLabelFor(wake)}` : 'wake time not added',
    rc ? `${rc} event${rc > 1 ? 's' : ''}` : 'no events',
  ].join(' · ');
}

function staleNotice(nightId) {
  const day = weekdayNameFor(nightId);
  return notice({
    text: `${day} still needs a review.`,
    children: [linkRow({ label: `Review ${day}`, href: `#/morning/${nightId}`, k: 'stale' })],
  });
}

// The night waiting for a review is the one the day phase reviews, so the
// link is a phase switch rather than a trip to the morning card.
function staleSwitch(nightId, draw) {
  const day = weekdayNameFor(nightId);
  return notice({
    text: `${day} still needs a review.`,
    children: [linkRow({ label: `Review ${day}`, k: 'stale', onClick: () => { visit.phase = 'day'; draw(); } })],
  });
}

/* A recorded review used to go stale when an entry landed under it, and every
   screen that could move one owed a warning. Nothing stores the outcome now,
   so a wet entry arriving on a night that read dry simply makes it wet. */

function failureNotice(draw) {
  const { label, retry } = state.failure;
  return notice({
    kind: 'error',
    title: `Not saved · ${label}`,
    text: NOT_SAVED,
    children: [button({ label: 'Retry saving', k: 'retry', onClick: retry })],
  });
}

/* ── The grid ───────────────────────────────────────────────────────────
   The five night actions keep their positions (handoff rule 2); the evening
   and day grids are their own stable sets. A transition sits last and wide.
   The step that would have brought the screen into this phase is offered
   again, compact, while its stamp is missing — the clock put the screen
   here, and the record should still get the time. */

function grid(ctx, t, draw) {
  const { phase, night, review } = t;
  if (phase === 'evening') {
    return h('div', { class: 'grid' },
      ['dinner', 'drink', 'lastToilet', 'lightsOut'].map(step => stepAction(ctx, step, night, draw)),
      stepAction(ctx, 'asleep', night, draw, 'transition'),
      dayRows(ctx, review, draw, true));
  }
  if (phase === 'night') {
    return h('div', { class: 'grid' },
      EVENT_ORDER.map(type => action(ctx, type, draw)),
      stepAction(ctx, 'wake', review, draw, 'transition'),
      (night?.evening?.asleepAt ?? null) === null ? stepAction(ctx, 'asleep', night, draw, 'compact') : null);
  }
  // No Dry / Wet pair: the outcome is read off the record (nightStatus).
  // She's up is what the day phase still has to collect — with no wet entry
  // it is the whole difference between a dry night and an unrecorded one, so
  // it leads the grid at full width rather than sitting in a corner.
  return [
    h('div', { class: 'grid' },
      stepAction(ctx, 'wake', review, draw, 'transition'),
      dayRows(ctx, review, draw, false)),
    linkRow({
      label: 'Log a night event that was missed',
      k: 'missed',
      onClick: () => { visit.phase = 'night'; draw(); },
    }),
  ];
}

function action(ctx, type, draw) {
  const def = EVENT_TYPES[type];
  const wet = type === 'wet';
  return h('button', {
    class: `action${wet ? ' wet' : ''}`,
    type: 'button',
    k: `action-${type}`,
    'on:click': () => logEvent(ctx, type, draw),
  },
  icon(def.icon),
  h('span', { text: def.label }, h('small', { text: ACTION_HINT[type] })),
  wet ? icon('plus', 'ico plus') : null);
}

// A stamped step shows its time and reads as recorded; the tap then opens
// its panel (Last toilet re-stamps, see STEPS). Drink shows its count.
function stepAction(ctx, step, owner, draw, extra = '') {
  const def = STEPS[step];
  let value = null;
  let hint = def.hint;
  if (step === 'drink') {
    const n = owner?.evening?.drinks?.length ?? 0;
    hint = n ? `${n} logged · tap for another` : def.hint;
  } else {
    value = owner?.[def.block]?.[def.key] ?? null;
    if (value) hint = def.restamp ? `${timeLabelFor(value)} · tap if she went again` : `${timeLabelFor(value)} · tap to edit`;
    else if (extra === 'compact') hint = 'Not timed yet · tap to record now';
  }
  return h('button', {
    class: `action${extra ? ` ${extra}` : ''}${value ? ' stamped' : ''}`,
    type: 'button',
    k: `step-${step}`,
    'on:click': () => tapStep(ctx, step, draw),
  },
  icon(def.icon),
  h('span', { text: def.label }, h('small', { text: hint })));
}

// Stool and daytime accidents are answers, not instants, so they are chip
// rows rather than actions: the first tap is the answer. In the evening they
// still describe today, the day after last night, so the same rows appear
// under the evening grid labelled as such.
function dayRows(ctx, review, draw, evening) {
  const day = review?.day ?? { accidents: null, stool: null };
  const stoolLabel = o => (o ? o.label.toLowerCase() : 'cleared');
  return h('div', { class: 'day-rows' },
    evening ? h('p', { class: 'small', text: `Today, the day after ${weekdayNameFor(review?.id ?? dayOwnerId(ctx.now()))} night` }) : null,
    chipGroup({
      label: DAY_FIELDS.stool.label, name: 'stool', options: DAY_FIELDS.stool.options, value: day.stool,
      onChange: v => writeReview(ctx, {
        block: 'day', key: 'stool', value: v, label: 'Stool',
        text: stoolLabel(DAY_FIELDS.stool.options.find(o => o.value === v)),
      }, draw),
    }),
    stepper({
      label: DAY_FIELDS.accidents.label, value: day.accidents, min: 0,
      onChange: v => writeReview(ctx, { block: 'day', key: 'accidents', value: v, label: 'Daytime accidents', text: String(v) }, draw),
    }));
}

/* ── Panels ─────────────────────────────────────────────────────────────
   One open at a time, below the saved strip so the grid never moves
   (handoff rule 2), and staying until Done, another tap, or navigation
   (rule 3). */

function openNode(ctx, draw) {
  const open = state.open;
  if (!open) return null;
  const { doc, night, nightId, review } = targets(ctx);
  if (open.kind === 'event') {
    const event = findEvent(nightForEvent(doc, open.id), open.id);
    if (!event) { state.open = null; return null; }
    return detail(ctx, event, draw, { onDone: () => { state.open = null; state.editingTime = false; draw(); } });
  }
  if (open.kind === 'drink') {
    const drink = findDrink(night?.evening ?? { drinks: [] }, open.id);
    if (!drink) { state.open = null; return null; }
    return drinkPanel(ctx, nightId, drink, draw);
  }
  const def = STEPS[open.key];
  const owner = def.block === 'morning' ? review : night;
  if (!owner) { state.open = null; return null; }
  return stepPanel(ctx, open.key, owner, draw);
}

function panelFoot(label, onDone) {
  return [
    h('p', { class: 'small', text: BLANK_OK }),
    state.panelError
      ? notice({ kind: 'error', title: `Not saved · ${label}`, text: state.panelError })
      // Always in the layout, lit or not: Done must never move under a finger
      // between the tap starting and landing.
      : h('p', { class: `saved-note${state.panelNote ? '' : ' quiet'}` },
        icon('check'), h('span', { text: state.panelNote || 'Saved' })),
    button({ label: 'Done', k: 'done', onClick: onDone }),
  ];
}

const closePanel = draw => () => { state.open = null; state.editingTime = false; draw(); };

function noteBox(ctx, { label, value, k, mutate, draw }) {
  const box = h('textarea', { rows: 3, k, 'aria-label': label, placeholder: 'Anything you want to remember?' });
  box.value = value ?? '';
  box.addEventListener('change', () => {
    const next = box.value.trim();
    // A focus-and-leave with nothing typed must not write, or every visit
    // would count as an answer.
    if (next !== (value ?? '')) quietWrite(ctx, draft => mutate(draft, next), draw, box);
  });
  return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), box);
}

function stepPanel(ctx, step, owner, draw) {
  const def = STEPS[step];
  const id = owner.id;
  const value = owner[def.block][def.key] ?? null;
  const set = mutate => panelWrite(ctx, draft => mutate(ensureNight(draft, id)), draw);
  const ev = owner.evening;
  const m = owner.morning;

  const fields = [];
  if (step === 'lastToilet') {
    fields.push(chipGroup({
      label: 'How much?', name: 'last-toilet-output', options: EVENING_FIELDS.lastToiletOutput.options,
      value: ev.lastToiletOutput, onChange: v => set(n => { n.evening.lastToiletOutput = v; }),
    }));
  }
  if (step === 'asleep') {
    fields.push(
      checkbox({
        label: 'Estimated', checked: !!ev.asleepEstimated, k: 'asleep-estimated',
        onChange: v => set(n => { n.evening.asleepEstimated = v; }),
      }),
      ev.drinks.length ? null : chipGroup({
        label: 'Evening drinks', name: 'no-drinks', options: [{ value: true, label: 'No evening drinks' }],
        value: ev.noDrinks, onChange: v => set(n => setNoDrinks(n.evening, v)),
      }),
      chipGroup({
        label: EVENING_FIELDS.dayContext.label, name: 'day-context', options: EVENING_FIELDS.dayContext.options,
        value: ev.dayContext, multi: true, onChange: v => set(n => { n.evening.dayContext = v; }),
      }),
      noteBox(ctx, {
        label: 'Note', value: ev.note, k: 'evening-note', draw,
        mutate: (draft, text) => { ensureNight(draft, id).evening.note = text; },
      }));
  }
  if (step === 'wake') {
    fields.push(
      chipGroup({
        label: MORNING_FIELDS.mood.label, name: 'mood', options: MORNING_FIELDS.mood.options, value: m.mood,
        onChange: v => set(n => { n.morning.mood = v; }),
      }),
      chipGroup({
        label: MORNING_FIELDS.sleepSigns.label, name: 'sleep-signs', options: MORNING_FIELDS.sleepSigns.options,
        value: m.sleepSigns, multi: true, reduce: toggleSleepSign,
        onChange: v => set(n => { n.morning.sleepSigns = v; }),
      }),
      chipGroup({
        label: 'Nighttime record', name: 'events-complete',
        options: [{ value: true, label: 'Night events complete' }], value: m.eventsComplete,
        onChange: v => set(n => { n.morning.eventsComplete = v; }),
      }),
      noteBox(ctx, {
        label: 'Note', value: m.note, k: 'morning-note', draw,
        mutate: (draft, text) => { ensureNight(draft, id).morning.note = text; },
      }));
  }

  return h('section', { class: 'detail', 'aria-label': `${def.label} detail` },
    h('div', { class: 'detail-head' },
      h('p', { class: 'overline', text: value ? stampLabelFor(value) : 'Not timed yet' }),
      h('h3', { text: def.label })),
    timeField({
      label: 'When', value, k: `${step}-time`,
      // The morning's time is on the calendar date after the night.
      dates: def.block === 'morning' ? dayDateFor(id) : [id, dayDateFor(id)],
      onCommit: iso => set(n => { n[def.block][def.key] = iso; }),
    }),
    fields,
    panelFoot(def.label, closePanel(draw)));
}

function drinkPanel(ctx, nightId, drink, draw) {
  const set = mutate => panelWrite(ctx, draft => {
    const d = findDrink(ensureNight(draft, nightId).evening, drink.id);
    if (d) mutate(d);
  }, draw);
  return h('section', { class: 'detail', 'aria-label': 'Drink detail' },
    h('div', { class: 'detail-head' },
      h('p', { class: 'overline', text: drink.at ? stampLabelFor(drink.at) : 'Not timed yet' }),
      h('h3', { text: 'Drink' })),
    timeField({
      label: 'When', value: drink.at, dates: [nightId, dayDateFor(nightId)], k: 'drink-time',
      onCommit: iso => set(d => { d.at = iso; }),
    }),
    chipGroup({
      label: 'How much?', name: 'drink-size', options: EVENING_FIELDS.drinkSize.options, value: drink.size,
      onChange: v => set(d => { d.size = v; }),
    }),
    panelFoot('Drink', closePanel(draw)));
}

/* ── Event detail (E01–E05) ───────────────────────────────────────────── */

export function renderEvent(el, ctx) {
  reset();
  state.open = { kind: 'event', id: ctx.params.id };
  const draw = () => { if (!state.suppress) paint(el, eventScreen(ctx, draw)); };
  draw();
  return ctx.store.subscribe(draw);
}

function eventScreen(ctx, draw) {
  const doc = ctx.store.get();
  const id = state.open?.id ?? null;
  const night = nightForEvent(doc, id);
  const event = findEvent(night, id);
  if (!event) {
    return [
      title({ overline: 'Entry', name: 'Not found' }),
      notice({ text: 'That entry is no longer recorded.' }),
    ];
  }
  return [
    title({ overline: stampLabelFor(event.t), name: EVENT_TYPES[event.type].label }),
    // The time can be edited here too, so the move notice belongs here as
    // well — the same feedback Tonight gives.
    state.moveNote ? notice({ text: state.moveNote }) : null,
    detail(ctx, event, draw, {
      onDone: () => ctx.back(),
      heading: false,
      // On its own screen a newly logged event gets its own URL, so the hash
      // never names one entry while another is on screen.
      onLogged: id => ctx.navigate(`#/event/${id}`),
    }),
  ];
}

function detail(ctx, event, draw, { onDone, heading = true, onLogged }) {
  const def = EVENT_TYPES[event.type];
  return h('section', { class: 'detail', 'aria-label': `${def.label} detail` },
    heading
      ? h('div', { class: 'detail-head' },
        h('p', { class: 'overline', text: stampLabelFor(event.t) }),
        h('h3', { text: def.label }))
      : null,
    state.editingTime
      ? dateTimeField({
        label: 'When it happened',
        value: event.t,
        now: ctx.now,
        help: 'The night an entry belongs to changes at 15:00.',
        // Named before it happens, then done on commit (handoff, night identity).
        preview: iso => {
          const to = iso ? nightIdForIso(iso) : null;
          return to && to !== nightIdForIso(event.t)
            ? `This moves the entry to the night of ${dayLabelFor(to)}.` : '';
        },
        onCommit: iso => moveEvent(ctx, event, iso, draw),
      })
      : linkRow({
        label: `${timeLabelFor(event.t)} · edit time`,
        icon: 'clock',
        k: 'edit-time',
        onClick: () => { state.editingTime = true; draw(); },
      }),
    def.fields.map(field => control(ctx, event, field, draw)),
    // A failed toilet attempt is its own fact — a wet bed is never manufactured
    // from "did not make it" (DESIGN.md §3).
    event.type === 'selfToilet'
      ? linkRow({ label: 'Also need to log a wet bed?', k: 'also-wet', onClick: () => logEvent(ctx, 'wet', draw, { onLogged }) })
      : null,
    panelFoot(`${def.label} at ${timeLabelFor(event.t)}`, onDone));
}

function control(ctx, event, field, draw) {
  const label = FIELD_COPY[`${event.type}.${field.key}`] ?? field.label;

  if (field.kind === 'text') {
    return noteBox(ctx, {
      label, value: event[field.key], k: `f-${field.key}`, draw,
      mutate: (draft, text) => {
        const found = findEvent(nightForEvent(draft, event.id), event.id);
        if (found) found[field.key] = text;
      },
    });
  }

  return chipGroup({
    label,
    name: field.key,
    options: field.options,
    value: event[field.key],
    multi: field.kind === 'multi',
    exclusive: field.exclusive ?? null,
    onChange: value => {
      const result = writeEventField(ctx, event, field.key, value);
      state.panelError = result.ok ? '' : NOT_SAVED;
      state.panelNote = result.ok ? 'Saved' : '';
      draw();
    },
  });
}
