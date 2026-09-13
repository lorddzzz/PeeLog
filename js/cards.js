// R01 evening, R02 morning, R03 following day (IMPLEMENTATION.md §2). Only
// R02's one-tap outcome exists yet (M1 commit 1d); renderEvening/renderDay
// land here at M2 without moving this one.

import {
  dayDateFor, dayLabelFor, ensureNight, findNight, outcomeConflict, timeLabelFor,
} from './model.js';
import {
  button, h, icon, linkRow, notice, paint, savedStrip, title,
} from './ui.js';

const NOT_SAVED = 'There isn’t enough space to save this. Keep this screen open and try again.';

/* ── Screen state ───────────────────────────────────────────────────────
   Module-level so another tab's write (store.subscribe re-render) cannot
   erase an in-flight conflict notice or failure. renderMorning resets it. */

const state = {
  nightId: null,
  conflict: null, // the wet event a Dry tap was refused against
  failure: null,  // the outcome a failed write should retry
};

function reset(nightId) {
  state.nightId = nightId;
  state.conflict = null;
  state.failure = null;
}

/* ── Writes ─────────────────────────────────────────────────────────────
   ensureNight, never openNight: a morning review does not reopen the night
   for logging, so activeNightId is left exactly where it was. */

function writeOutcome(ctx, outcome, draw) {
  const result = ctx.store.update(draft => {
    ensureNight(draft, state.nightId).morning.outcome = outcome;
  });
  if (!result.ok) {
    state.failure = outcome;
    draw();
    return;
  }
  state.failure = null;
  draw();
}

// Tapping the outcome already recorded does nothing — it is never cleared to
// unknown from here, only changed by an explicit alternative tap.
function tapOutcome(ctx, night, outcome, draw) {
  if ((night?.morning?.outcome ?? null) === outcome) return;
  if (outcome === 'dry') {
    const conflict = outcomeConflict(night, 'dry');
    if (conflict) { state.conflict = conflict; draw(); return; }
  }
  state.conflict = null;
  writeOutcome(ctx, outcome, draw);
}

/* ── Morning (R02, one-tap outcome only) ───────────────────────────────── */

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
  const outcome = night?.morning?.outcome ?? null;

  return [
    title({
      overline: dayLabelFor(dayDateFor(id)),
      name: 'Morning check-in',
      lead: 'How was the night?',
    }),
    wetEvents.length ? h('p', { class: 'context', text: wetContextLine(wetEvents) }) : null,
    h('div', { class: 'grid' },
      outcomeButton(ctx, night, 'dry', 'Dry night', 'dry', draw),
      outcomeButton(ctx, night, 'wet', 'Wet night', 'drop', draw)),
    state.conflict ? conflictNotice(ctx, draw) : null,
    state.failure ? failureNotice(ctx, draw) : null,
    outcome ? confirmation(ctx, id) : null,
  ];
}

function wetContextLine(events) {
  const first = timeLabelFor(events[0].t);
  return events.length === 1
    ? `1 wet-bed entry recorded at ${first}`
    : `${events.length} wet-bed entries recorded · first at ${first}`;
}

function outcomeButton(ctx, night, value, label, iconName, draw) {
  const selected = (night?.morning?.outcome ?? null) === value;
  return h('button', {
    class: `action${selected ? ' selected' : ''}`,
    type: 'button',
    k: `outcome-${value}`,
    'aria-pressed': selected ? 'true' : 'false',
    'on:click': () => tapOutcome(ctx, night, value, draw),
  }, icon(iconName), h('span', { text: label }));
}

// Dry can never erase the mistaken record — only review or an explicit Wet
// tap moves the outcome past this point.
function conflictNotice(ctx, draw) {
  const event = state.conflict;
  return notice({
    kind: 'warm',
    title: 'This night includes a wet-bed entry.',
    text: 'Review the entry before marking the night dry.',
    children: [
      linkRow({ label: 'Review entries', href: `#/event/${event.id}`, k: 'review-entries' }),
      button({
        label: 'Keep wet night', k: 'keep-wet',
        onClick: () => { state.conflict = null; writeOutcome(ctx, 'wet', draw); },
      }),
    ],
  });
}

function failureNotice(ctx, draw) {
  const outcome = state.failure;
  return notice({
    kind: 'error',
    title: 'Not saved',
    text: NOT_SAVED,
    children: [
      button({ label: 'Retry saving', k: 'retry', onClick: () => writeOutcome(ctx, outcome, draw) }),
    ],
  });
}

// R04: same treatment whether the outcome is Dry or Wet, and the buttons
// above stay visible and editable — this is a confirmation, not a hand-off
// to a different screen.
function confirmation(ctx, id) {
  return h('div', {},
    savedStrip({
      text: 'Night outcome recorded',
      detail: 'Morning review saved',
      onOpen: () => ctx.navigate(`#/night/${id}`),
    }),
    linkRow({ label: 'Back to Tonight', href: '#/tonight', k: 'back-tonight' }),
    // History (and this route) arrive in M3; today it falls back to Tonight.
    linkRow({ label: 'See this night', href: `#/night/${id}`, k: 'see-night' }),
    h('p', { class: 'small', text: 'More detail arrives in the next update.' }));
}
