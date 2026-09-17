// T01–T02 and E01–E05. The first tap writes the event (AGENTS.md rule 6):
// nothing on this screen may put a form, a confirm or a timer in front of it,
// and nothing says Saved before store.update returns ok.

import {
  EVENT_ORDER, EVENT_TYPES, activeNightFor, dayIsUnanswered, dayLabelFor,
  ensureNight, eveningSummaryFor, findEvent, findNight, insertEvent, isReviewed,
  latestEvent, moveEventTo, newEvent, nightForEvent, nightIdFor,
  nightIdForIso, openNight, pendingReviewFor, prevNightId, removeEvent,
  stampLabelFor, timeLabelFor, toIso, weekdayNameFor,
} from './model.js';
import {
  button, chipGroup, dateTimeField, h, icon, linkRow, notice, paint, savedStrip,
  title,
} from './ui.js';

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
const BLANK_OK = 'You can leave these blank and come back in the morning.';

/* ── Screen state ───────────────────────────────────────────────────────
   Kept at module level so a re-render from store.subscribe cannot close an
   open detail panel. Navigation resets it; a store write does not. */

const state = {
  openEventId: null,   // detail panel open for this event
  editingTime: false,
  panelNote: '',       // quiet "Saved" inside the panel
  panelError: '',
  moveNote: '',
  failure: null,       // { type, t } — the tap that did not save, for Retry
  undoError: '',
  reviewTouched: null, // night whose completed review may now be out of date
  suppress: false,     // a write that must not rebuild the panel; see setText
};

function reset() {
  state.openEventId = null;
  state.editingTime = false;
  state.panelNote = '';
  state.panelError = '';
  state.moveNote = '';
  state.failure = null;
  state.undoError = '';
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

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
  const reviewed = isReviewed(findNight(ctx.store.get(), id));
  let created = null;

  const result = ctx.store.update(draft => {
    // Only a tap that belongs to tonight opens a night for logging; filing a
    // late retry into an earlier one must not move activeNightId backwards.
    const night = id === tonightId ? openNight(draft, id) : ensureNight(draft, id);
    created = insertEvent(night, newEvent(type, t)).id;
  });

  if (!result.ok) {
    state.failure = { type, t };
    draw();
    return;
  }
  state.failure = null;
  state.openEventId = created;
  state.editingTime = false;
  state.panelNote = '';
  state.panelError = '';
  state.moveNote = '';
  state.undoError = '';
  // Handoff T03: an extra event after the review is visible, never a silent
  // change to an outcome someone already recorded.
  if (reviewed) state.reviewTouched = id;
  if (onLogged) onLogged(created);
  else draw();
}

function undoEvent(ctx, event, draw) {
  const result = ctx.store.update(draft => {
    const night = nightForEvent(draft, event.id);
    if (night) removeEvent(night, event.id);
  });
  if (!result.ok) {
    state.undoError = `Removal did not save · ${EVENT_TYPES[event.type].label} at ${timeLabelFor(event.t)}`;
    draw();
    return;
  }
  state.undoError = '';
  if (state.openEventId === event.id) {
    state.openEventId = null;
    state.editingTime = false;
  }
  state.panelNote = '';
  state.moveNote = '';
  draw();
}

function writeField(ctx, event, key, value) {
  return ctx.store.update(draft => {
    const found = findEvent(nightForEvent(draft, event.id), event.id);
    if (found) found[key] = value;
  });
}

function setField(ctx, event, key, value, draw) {
  const result = writeField(ctx, event, key, value);
  state.panelError = result.ok ? '' : NOT_SAVED;
  state.panelNote = result.ok ? 'Saved' : '';
  draw();
}

// A note commits on blur — which happens while the finger is still on Done.
// Rebuilding the panel there swallows that tap, so a successful text write
// only lights up the Saved line, which is always in the layout already.
function setText(ctx, event, key, value, draw, box) {
  state.suppress = true;
  const result = writeField(ctx, event, key, value);
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

// An edited timestamp moves the event, and may move it to another night.
function moveEvent(ctx, event, t, draw) {
  const to = nightIdForIso(t);
  const moved = to !== nightIdForIso(event.t);
  const reviewed = isReviewed(findNight(ctx.store.get(), to));
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
  // Same rule as a new tap: an outcome someone already recorded is never
  // silently changed by an entry arriving under it.
  if (moved && reviewed) state.reviewTouched = to;
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
  const doc = ctx.store.get();
  const active = activeNightFor(doc, ctx.now());
  const night = findNight(doc, active.id);
  const events = night?.events ?? [];
  const latest = latestEvent(night);
  const open = state.openEventId ? findEvent(night, state.openEventId) : null;
  if (!open) state.openEventId = null;
  // activeNightFor stops reporting yesterday the moment tonight is opened, so
  // the review link is asked for separately and survives the first tap.
  const stale = active.stale ?? pendingReviewFor(doc, active.id);

  return [
    header(active.id),
    stale ? staleNotice(stale) : null,
    h('p', { class: 'context', text: contextLine(night, events.length) }),
    h('div', { class: 'grid' }, EVENT_ORDER.map(type => action(ctx, type, draw))),
    state.failure ? failureNotice(ctx, draw) : null,
    latest
      ? savedStrip({
        text: `${EVENT_TYPES[latest.type].label} · ${timeLabelFor(latest.t)}`,
        detail: open && open.id === latest.id ? 'Saved · details below' : 'Saved · tap for detail',
        onOpen: () => {
          state.openEventId = latest.id;
          state.editingTime = false;
          state.panelNote = '';
          state.moveNote = '';
          draw();
        },
        onUndo: () => undoEvent(ctx, latest, draw),
      })
      : savedStrip({ text: 'Nothing logged yet', detail: 'Ready whenever you need it.' }),
    state.undoError ? notice({ kind: 'error', title: state.undoError, text: 'The entry is still recorded. Try Undo again.' }) : null,
    state.moveNote ? notice({ text: state.moveNote }) : null,
    reviewNotice(doc, state.reviewTouched, active.id),
    open ? detail(ctx, open, draw, { onDone: () => { state.openEventId = null; state.editingTime = false; draw(); } }) : null,
    linkRow({
      label: 'Evening details',
      sub: eveningSummaryFor(night?.evening) ?? 'What she wore, drinks, and sleep',
      href: `#/evening/${active.id}`,
      k: 'evening',
    }),
    linkRow({
      label: isReviewed(night) ? 'Morning review recorded' : 'Ready for the morning?',
      href: `#/morning/${active.id}`,
      k: 'morning',
    }),
    yesterdayDaytimeLink(doc, active.id),
  ];
}

// Only while yesterday's following-day card is still untouched — once it has
// an answer, correcting it is History's job (M3), not a nightly nag here.
function yesterdayDaytimeLink(doc, activeId) {
  const prevId = prevNightId(activeId);
  const prev = findNight(doc, prevId);
  if (!prev || !dayIsUnanswered(prev.day)) return null;
  return linkRow({ label: "Add yesterday's daytime", href: `#/day/${prevId}`, k: 'prev-day' });
}

function header(nightId) {
  // Decoration only: hidden by body.no-art without moving a single control.
  const art = h('img', { class: 'art', src: 'assets/art/bedtime-moon.jpg', alt: '' });
  return h('div', { class: 'title-art' }, art,
    h('div', {}, title({
      overline: dayLabelFor(nightId),
      name: 'Tonight',
      lead: 'One tap. Back to rest.',
    })));
}

// Never infer a dry night from an empty list (handoff T01).
function contextLine(night, count) {
  const asleep = night?.evening?.asleepAt ?? null;
  const sleep = asleep ? `Asleep at ${timeLabelFor(asleep)}` : 'Sleep time not added';
  return `${sleep} · ${count ? `${count} event${count > 1 ? 's' : ''}` : 'no events'}`;
}

function staleNotice(nightId) {
  const day = weekdayNameFor(nightId);
  return notice({
    text: `${day} still needs a review.`,
    children: [linkRow({ label: `Review ${day}`, href: `#/morning/${nightId}`, k: 'stale' })],
  });
}

// An entry landed under a night whose review is already recorded — by a tap, a
// move, an edit or a delete. A night other than the one on screen is named, or
// the warning reads as if it were about tonight. Exported because History's
// event editing (H04) changes the same nights and owes the same warning.
export function reviewNotice(doc, id, shownId) {
  const night = id ? findNight(doc, id) : null;
  if (!night || !isReviewed(night)) return null;
  return notice({
    kind: 'warm',
    title: 'Morning review may need updating',
    text: id === shownId
      ? 'This night already has an outcome recorded.'
      : `The night of ${dayLabelFor(id)} already has an outcome recorded.`,
    children: [linkRow({ label: `Review ${weekdayNameFor(id)} again`, href: `#/morning/${id}`, k: 'rereview' })],
  });
}

function failureNotice(ctx, draw) {
  const { type, t } = state.failure;
  return notice({
    kind: 'error',
    title: `Not saved · ${EVENT_TYPES[type].label} at ${timeLabelFor(t)}`,
    text: NOT_SAVED,
    children: [
      // The retry keeps the original timestamp: the event happened then, not
      // when the storage finally accepted it.
      button({ label: 'Retry saving', k: 'retry', onClick: () => logEvent(ctx, type, draw, { at: t }) }),
    ],
  });
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

/* ── Event detail (E01–E05) ─────────────────────────────────────────────
   Opens below the saved strip so the action grid never moves (handoff rule 2)
   and stays until Done, another event, or navigation (rule 3). */

export function renderEvent(el, ctx) {
  reset();
  state.openEventId = ctx.params.id;
  const draw = () => { if (!state.suppress) paint(el, eventScreen(ctx, draw)); };
  draw();
  return ctx.store.subscribe(draw);
}

function eventScreen(ctx, draw) {
  const doc = ctx.store.get();
  const night = nightForEvent(doc, state.openEventId);
  const event = findEvent(night, state.openEventId);
  if (!event) {
    return [
      title({ overline: 'Entry', name: 'Not found' }),
      notice({ text: 'That entry is no longer recorded.' }),
    ];
  }
  return [
    title({ overline: stampLabelFor(event.t), name: EVENT_TYPES[event.type].label }),
    // The time can be edited here too, so the move and re-review notices
    // belong here as well — the same feedback Tonight gives.
    state.moveNote ? notice({ text: state.moveNote }) : null,
    reviewNotice(doc, state.reviewTouched, night?.id ?? null),
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
    h('p', { class: 'small', text: BLANK_OK }),
    state.panelError
      ? notice({ kind: 'error', title: `Not saved · ${def.label} at ${timeLabelFor(event.t)}`, text: state.panelError })
      // Always in the layout, lit or not: Done must never move under a finger
      // between the tap starting and landing.
      : h('p', { class: `saved-note${state.panelNote ? '' : ' quiet'}` },
        icon('check'), h('span', { text: state.panelNote || 'Saved' })),
    button({ label: 'Done', k: 'done', onClick: onDone }));
}

function control(ctx, event, field, draw) {
  const label = FIELD_COPY[`${event.type}.${field.key}`] ?? field.label;

  if (field.kind === 'text') {
    const box = h('textarea', {
      rows: 3,
      k: `f-${field.key}`,
      'aria-label': label,
      placeholder: field.placeholder ?? '',
    });
    box.value = event[field.key] ?? '';
    box.addEventListener('change', () => {
      const next = box.value.trim();
      // A focus-and-leave with nothing typed must not write, or every visit
      // would count as an answer.
      if (next !== (event[field.key] ?? '')) setText(ctx, event, field.key, next, draw, box);
    });
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), box);
  }

  return chipGroup({
    label,
    name: field.key,
    options: field.options,
    value: event[field.key],
    multi: field.kind === 'multi',
    exclusive: field.exclusive ?? null,
    onChange: value => setField(ctx, event, field.key, value, draw),
  });
}
