// H01–H06: the nights list, one night's record, event correction, backfill,
// and deleting a night. This is where yesterday gets fixed at breakfast, so
// every destructive step is named, confirmed, and undoable — and an edit here
// is a draft with an explicit Save, unlike Tonight's one-tap chips.

import {
  DAY_FIELDS, EVENT_ORDER, EVENT_TYPES, backfillTarget, clone, dayDateFor,
  dayIsUnanswered, dayLabelFor, deleteNight, ensureNight, eventCounts,
  eventDetailSummary, findEvent, findNight, firstWetTime, insertEvent, isReviewed,
  monthLabelFor, monthNightsWithGaps, monthOf, moveEventTo, newEvent,
  nightForEvent, nightIdFor, nightIdForIso, nightLabelFor, nightStatus,
  openNight, parseIso, removeEvent, restoreNight, retypeEvent, shiftMonth,
  timeLabelFor, weekdayNameFor,
} from './model.js';
import {
  button, chipGroup, dateField, dateTimeField, h, icon, linkRow, notice, paint,
  savedStrip, sheet, title,
} from './ui.js';
import { FIELD_COPY } from './tonight.js';

/* ── Screen copy ───────────────────────────────────────────────────────── */

// Outcome states are labelled, never colour alone: a night nobody has been up
// on yet is a different fact from a confirmed dry one, and a calendar gap
// reads "No record" — never Dry (UX-HANDOFF S01).
const STATUS = {
  dry: { icon: 'dry', label: 'Dry', cls: '' },
  wet: { icon: 'drop', label: 'Wet', cls: ' wet' },
  'review-due': { icon: 'review', label: 'No wake time', cls: ' open' },
  'no-record': { icon: 'missing', label: 'No record', cls: ' open' },
};

// Only the three that change how a night reads at a glance; a drink or a wake
// belongs in the night's own record, not in a one-line summary.
const COUNT_LABEL = {
  wet: n => `${n} wet`,
  selfToilet: n => `${n} asked to pee`,
  lift: n => `${n} lift${n > 1 ? 's' : ''}`,
};

const NOT_SAVED = 'There isn’t enough space to save this. Keep this screen open and try again.';
const NOT_REMOVED = 'The entry is still recorded. Try again.';
const RETYPE = 'Changing the type clears its details';

/* ── Screen state ───────────────────────────────────────────────────────
   Module level, so a re-render from store.subscribe cannot drop a half-typed
   draft. `pending` carries feedback across the one navigation that caused it
   — an Undo strip has to appear on the screen you land on, not the one you
   just left. */

const state = { month: null, filter: 'all', undoNight: null, error: '' };

const nightState = {
  id: null,
  note: '',
  error: '',
  undoEvent: null,     // { nightId, event } removed here, restorable from here
  confirmDelete: false,
};

const edit = {
  nightId: null, eventId: null, isNew: false,
  original: null,      // the stored event, for Cancel and for the retype notice
  type: null, t: null, fields: {},
  error: '', confirmDelete: false,
};

let pendingNight = null; // { id, note, undoEvent }
let pendingList = null;  // { undoNight }
let pendingAddDate = null;

/* ── H01 · Nights ───────────────────────────────────────────────────────── */

export function render(el, ctx) {
  state.undoNight = pendingList?.undoNight ?? null;
  state.error = '';
  pendingList = null;
  // The month survives navigating into a night and back; it is only chosen
  // for you the first time, or when nothing has been recorded in it yet.
  if (!state.month) state.month = defaultMonth(ctx.store.get(), ctx.now());
  const draw = () => paint(el, list(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function defaultMonth(doc, now) {
  const latest = doc.nights.length ? doc.nights[doc.nights.length - 1].id : null;
  return monthOf(latest) ?? monthOf(nightIdFor(now));
}

function list(ctx, draw) {
  const doc = ctx.store.get();
  const rows = monthNightsWithGaps(doc, state.month, ctx.now())
    .filter(row => state.filter !== 'review' || row.status === 'review-due');

  return [
    title({ overline: 'One night at a time', name: 'History' }),
    subnav('nights'),
    state.undoNight ? undoNightStrip(ctx, draw) : null,
    state.error ? notice({ kind: 'error', title: state.error, text: NOT_REMOVED }) : null,
    doc.nights.length ? nightsList(ctx, rows, draw) : emptyHistory(),
  ];
}

function nightsList(ctx, rows, draw) {
  return [
    monthNav(ctx, draw),
    filterChips(draw),
    rows.length
      ? rows.map(row => (row.kind === 'night' ? nightRow(row) : gapRow(ctx, row)))
      : h('p', { class: 'small', text: state.filter === 'review'
        ? 'Nothing in this month is waiting for a review.'
        : 'No nights recorded in this month.' }),
    button({ label: 'Add past night', href: '#/history/add', k: 'add-night' }),
  ];
}

// H02: nothing recorded at all. Art is decoration — body.no-art hides it
// without moving either button.
function emptyHistory() {
  return [
    h('img', { class: 'art', src: 'assets/art/bedside-notebook.jpg', alt: '' }),
    h('h3', { text: 'No nights yet' }),
    h('p', { class: 'lead', text: 'A few notes tonight are a place to start.' }),
    button({ label: 'Start tonight', href: '#/tonight', kind: 'primary', k: 'start' }),
    button({ label: 'Add past night', href: '#/history/add', k: 'add-night' }),
  ];
}

export function subnav(current) {
  const items = [['nights', 'Nights', '#/history'], ['patterns', 'Patterns', '#/patterns'],
    ['routines', 'Routines', '#/routines']];
  return h('nav', { class: 'subnav', 'aria-label': 'History sections' },
    items.map(([id, label, href]) =>
      h('a', { class: current === id ? 'selected' : '', href, 'aria-current': current === id ? 'page' : null }, label)));
}

function monthNav(ctx, draw) {
  // Nothing has been recorded in a month that has not started yet, so forward
  // stops at the month tonight belongs to.
  const last = monthOf(nightIdFor(ctx.now()));
  const step = delta => { state.month = shiftMonth(state.month, delta); draw(); };
  return h('div', { class: 'month' },
    h('button', {
      class: 'chip', type: 'button', k: 'prev-month', 'aria-label': 'Previous month',
      'on:click': () => step(-1),
    }, icon('back')),
    h('strong', { text: monthLabelFor(state.month) }),
    h('button', {
      class: 'chip', type: 'button', k: 'next-month', 'aria-label': 'Next month',
      disabled: state.month >= last || null,
      'on:click': () => step(1),
    }, icon('chevron-right')));
}

function filterChips(draw) {
  return h('div', { class: 'chips' }, [['all', 'All'], ['review', 'Needs review']].map(([value, label]) =>
    h('button', {
      class: `chip${state.filter === value ? ' selected' : ''}`,
      type: 'button', k: `filter-${value}`,
      'aria-pressed': state.filter === value ? 'true' : 'false',
      'on:click': () => { state.filter = value; draw(); },
    }, label)));
}

function nightRow(row) {
  return h('a', { class: 'history-row', href: `#/night/${row.id}` },
    h('span', { text: dayLabelFor(row.id) }, h('small', { text: rowSummary(row.night) })),
    outcomeTag(row.status));
}

// A date inside the month with no record at all. It offers the one thing that
// can be done about it, with its date already chosen.
function gapRow(ctx, row) {
  return h('button', {
    class: 'history-row gap', type: 'button', k: `gap-${row.id}`,
    'on:click': () => { pendingAddDate = row.id; ctx.navigate('#/history/add'); },
  },
  h('span', { text: dayLabelFor(row.id) }, h('small', { text: 'No entries for this date' })),
  outcomeTag('no-record'));
}

function outcomeTag(status) {
  const s = STATUS[status];
  return h('span', { class: `outcome${s.cls}` }, icon(s.icon), h('span', { text: s.label }));
}

function rowSummary(night) {
  const parts = [];
  const wet = firstWetTime(night);
  if (wet) parts.push(`first wet ${timeLabelFor(wet)}`);
  const counts = eventCounts(night);
  for (const [type, label] of Object.entries(COUNT_LABEL)) {
    // The first wetting's time already says there was one; the count only
    // adds something once there is more than one.
    if (type === 'wet' && wet && counts.wet < 2) continue;
    if (counts[type]) parts.push(label(counts[type]));
  }
  return parts.length ? parts.join(' · ') : 'No entries recorded';
}

function undoNightStrip(ctx, draw) {
  const removed = state.undoNight;
  const count = removed.night.events.length;
  return savedStrip({
    text: `Night of ${dayLabelFor(removed.night.id)} removed`,
    detail: count ? `${count} event${count > 1 ? 's' : ''} removed with it` : 'Nothing else was removed',
    onUndo: () => {
      let back = null;
      const result = ctx.store.update(draft => {
        back = restoreNight(draft, removed.night, removed.wasActive);
      });
      if (!result.ok) { state.error = 'The night was not restored'; draw(); return; }
      state.undoNight = null;
      // Recorded again while the strip was on screen: putting the copy back
      // would drop whatever went into it since.
      state.error = back ? '' : 'That night is recorded again; nothing was restored.';
      draw();
    },
  });
}

/* ── H03 · One night ────────────────────────────────────────────────────── */

export function renderNight(el, ctx) {
  resetNight(ctx.params.nightId);
  const draw = () => paint(el, nightDetail(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function resetNight(id) {
  const pending = pendingNight && pendingNight.id === id ? pendingNight : null;
  pendingNight = null;
  nightState.id = id;
  nightState.note = pending?.note ?? '';
  nightState.undoEvent = pending?.undoEvent ?? null;
  nightState.error = '';
  nightState.confirmDelete = false;
}

function nightDetail(ctx, draw) {
  const id = nightState.id;
  const doc = ctx.store.get();
  const night = findNight(doc, id);

  if (!night) {
    return [
      title({ overline: nightLabelFor(id), name: 'No record' }),
      notice({ text: 'Nothing has been recorded for this night yet.' }),
      button({ label: 'Add this night', href: '#/history/add', k: 'add' }),
    ];
  }

  return [
    title({ overline: nightLabelFor(id), name: `${weekdayNameFor(id)} night` }),
    h('p', { class: 'context', text: statusLine(night) }),
    nightState.note ? h('p', { class: 'saved-note' }, icon('check'), h('span', { text: nightState.note })) : null,
    nightState.undoEvent ? undoEventStrip(ctx, draw) : null,
    nightState.error ? notice({ kind: 'error', title: nightState.error, text: NOT_REMOVED }) : null,
    isReviewed(night) ? null : notice({
      title: 'No wake time',
      text: 'Without one, a night with no wet-bed entry cannot be read as dry.',
      children: [linkRow({ label: `Review ${weekdayNameFor(id)}`, href: `#/morning/${id}`, k: 'review' })],
    }),
    sheet(
      h('h3', { text: 'Evening' }),
      h('p', { class: 'lead', text: eveningLine(night) }),
      linkRow({ label: 'Edit evening details', href: `#/evening/${id}`, k: 'evening' })),
    sheet(
      h('h3', { text: 'Events' }),
      night.events.length
        ? night.events.map(ev => linkRow({
          label: `${timeLabelFor(ev.t)} · ${EVENT_TYPES[ev.type]?.label ?? ev.type}`,
          sub: eventDetailSummary(ev) || 'No detail added',
          href: `#/night/${id}/event/${ev.id}`,
          k: `ev-${ev.id}`,
        }))
        : h('p', { class: 'lead', text: 'No entries recorded for this night.' }),
      button({ label: 'Add an event', href: `#/night/${id}/event/new`, k: 'add-event' })),
    sheet(
      h('h3', { text: 'Morning' }),
      h('p', { class: 'lead', text: morningLine(night) }),
      linkRow({ label: 'Edit morning review', href: `#/morning/${id}`, k: 'morning' })),
    sheet(
      h('h3', { text: 'Following day' }),
      h('p', { class: 'lead', text: `${weekdayNameFor(dayDateFor(id))} daytime · ${dayLine(night)}` }),
      linkRow({
        label: dayIsUnanswered(night.day) ? 'Add daytime details' : 'Edit daytime details',
        href: `#/day/${id}`, k: 'day',
      })),
    nightState.confirmDelete
      ? deleteNightSheet(ctx, night, draw)
      : button({
        label: 'Delete this night…', kind: 'danger', icon: 'delete', k: 'delete-night',
        onClick: () => { nightState.confirmDelete = true; draw(); },
      }),
  ];
}

// What the record says, and what it is read off — a derived outcome should
// never look like an answer somebody typed, and a night reviewed before the
// outcome was derived must not be credited with a wake time it never had.
function statusLine(night) {
  const status = nightStatus(night);
  if (status === 'review-due') return 'No wake time · nobody has recorded this morning yet';
  if (status === 'wet' && (night?.events ?? []).some(e => e?.type === 'wet')) {
    return 'Wet night · a wet-bed entry is recorded';
  }
  if (status === 'dry' && (night?.morning?.wakeAt ?? null) !== null) {
    return 'Dry night · no wet-bed entry, and she was up';
  }
  return `${status === 'wet' ? 'Wet' : 'Dry'} night · recorded before the outcome was read off the night`;
}

function eveningLine(night) {
  const ev = night.evening;
  const parts = [];
  if (ev.dinnerAt) parts.push(`dinner ${timeLabelFor(ev.dinnerAt)}`);
  if (ev.noDrinks) parts.push('no drinks');
  else if (ev.drinks.length) parts.push(`${ev.drinks.length} drink${ev.drinks.length > 1 ? 's' : ''}`);
  if (ev.lastToiletAt) parts.push(`last toilet ${timeLabelFor(ev.lastToiletAt)}`);
  if (ev.asleepAt) parts.push(`asleep ${timeLabelFor(ev.asleepAt)}${ev.asleepEstimated ? ' (estimated)' : ''}`);
  if (ev.dayContext.length) parts.push(ev.dayContext.join(', '));
  if (ev.note) parts.push('note added');
  return parts.length ? parts.join(' · ') : 'Not added';
}

function morningLine(night) {
  const m = night.morning;
  const parts = [];
  if (m.outcome) parts.push(m.outcome === 'dry' ? 'Dry night' : 'Wet night');
  if (m.wakeAt) parts.push(`awake at ${timeLabelFor(m.wakeAt)}`);
  if (m.mood) parts.push(`mood ${m.mood}`);
  if (m.sleepSigns?.length) parts.push(`sleep signs: ${m.sleepSigns.join(', ')}`);
  if (m.eventsComplete) parts.push('night events complete');
  if (m.note) parts.push('note added');
  return parts.length ? parts.join(' · ') : 'Not added';
}

function dayLine(night) {
  if (dayIsUnanswered(night.day)) return 'Not added';
  const parts = [];
  for (const [key, field] of Object.entries(DAY_FIELDS)) {
    const value = night.day[key];
    if (value === null || value === undefined) continue;
    const option = field.options?.find(o => o.value === value);
    parts.push(`${field.label.toLowerCase()} ${option ? option.label.toLowerCase() : value}`);
  }
  return parts.join(' · ');
}

function undoEventStrip(ctx, draw) {
  const { nightId, event } = nightState.undoEvent;
  return savedStrip({
    text: `${EVENT_TYPES[event.type]?.label ?? event.type} at ${timeLabelFor(event.t)} removed`,
    detail: 'Undo puts it back on this night',
    onUndo: () => {
      const result = ctx.store.update(draft => {
        insertEvent(ensureNight(draft, nightId), clone(event));
      });
      if (!result.ok) { nightState.error = 'The entry was not restored'; draw(); return; }
      nightState.undoEvent = null;
      nightState.error = '';
      nightState.note = 'Entry restored';
      draw();
    },
  });
}

// H06: the whole-night confirmation names the date and exactly how much goes
// with it. Deleting a night is a separate decision from deleting an entry.
function deleteNightSheet(ctx, night, draw) {
  const count = night.events.length;
  return sheet(
    h('h3', {
      text: count
        ? `Delete the night of ${dayLabelFor(night.id)} and its ${count} event${count > 1 ? 's' : ''}?`
        : `Delete the night of ${dayLabelFor(night.id)}?`,
    }),
    h('p', { class: 'lead', text: 'Its evening, morning and daytime details go with it.' }),
    button({
      label: 'Delete night', kind: 'danger', k: 'confirm-delete',
      onClick: () => {
        let removed = null;
        const result = ctx.store.update(draft => { removed = deleteNight(draft, night.id); });
        // S02: the record stays visible and nothing claims it was removed.
        if (!result.ok || !removed) {
          nightState.error = 'Removal did not save';
          nightState.confirmDelete = false;
          draw();
          return;
        }
        pendingList = { undoNight: removed };
        ctx.navigate('#/history', { replace: true });
      },
    }),
    button({ label: 'Cancel', kind: 'quiet', k: 'cancel-delete', onClick: () => { nightState.confirmDelete = false; draw(); } }));
}

/* ── H04 · Edit or move an event ────────────────────────────────────────
   A draft, not a live chip: nothing is written until Save, Cancel keeps the
   original, and a type change clears the old type's details only on Save. */

export function renderEventEdit(el, ctx) {
  loadDraft(ctx);
  const draw = () => paint(el, eventEdit(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function loadDraft(ctx) {
  const doc = ctx.store.get();
  const { nightId, eventId } = ctx.params;
  const isNew = eventId === 'new';
  // Found by id across the document: a hash kept from before a move names the
  // night the entry used to be on.
  const event = isNew ? null : findEvent(nightForEvent(doc, eventId), eventId);

  edit.nightId = nightId;
  edit.eventId = eventId;
  edit.isNew = isNew;
  edit.original = event;
  edit.type = event?.type ?? null;
  // Never "now": a past night's entry has to be given its real date and time
  // (UX-HANDOFF H04), so an empty field stays empty until someone types one.
  edit.t = event?.t ?? null;
  edit.fields = draftFields(event?.type ?? null, event);
  edit.error = '';
  edit.confirmDelete = false;
}

function draftFields(type, source) {
  const out = {};
  for (const f of EVENT_TYPES[type]?.fields ?? []) {
    const blank = f.kind === 'multi' ? [] : f.kind === 'text' ? '' : null;
    const value = source ? source[f.key] : blank;
    // Copied, never aliased: the draft must not reach into the stored document.
    out[f.key] = Array.isArray(value) ? [...value] : value ?? blank;
  }
  return out;
}

function eventEdit(ctx, draw) {
  const id = edit.nightId;
  if (!edit.isNew && !edit.original) {
    return [
      title({ overline: nightLabelFor(id), name: 'Not found' }),
      notice({ text: 'That entry is no longer recorded.' }),
    ];
  }

  const def = edit.type ? EVENT_TYPES[edit.type] : null;
  const retyped = !!edit.original && edit.type !== edit.original.type;

  return [
    title({
      overline: nightLabelFor(id),
      name: edit.isNew ? 'Add an event' : 'Edit event',
      lead: edit.isNew ? 'Give it the date and time it actually happened.' : null,
    }),
    chipGroup({
      label: 'What happened', name: 'type',
      options: EVENT_ORDER.map(type => ({ value: type, label: EVENT_TYPES[type].label })),
      value: edit.type,
      onChange: value => setType(value, draw),
    }),
    // Named before Save, not discovered after it (UX-HANDOFF night identity).
    retyped && hasDetail(edit.original)
      ? notice({ kind: 'warm', title: RETYPE, text: `The ${EVENT_TYPES[edit.original.type].label.toLowerCase()} details on this entry are removed when you save.` })
      : null,
    dateTimeField({
      label: 'When it happened',
      value: edit.t,
      now: ctx.now,
      help: 'The night an entry belongs to changes at 15:00.',
      preview: iso => {
        const to = iso ? nightIdForIso(iso) : null;
        if (!to) return '';
        if (edit.original && to !== nightIdForIso(edit.original.t)) {
          return `This entry will move to the night of ${dayLabelFor(to)}.`;
        }
        return `This entry belongs to the night of ${dayLabelFor(to)}.`;
      },
      onCommit: iso => {
        edit.t = iso;
        if (edit.error) { edit.error = ''; draw(); }
      },
    }),
    def ? def.fields.map(field => control(field, draw)) : null,
    edit.error
      ? notice({
        kind: 'error',
        title: edit.error,
        text: edit.isNew ? 'Nothing was added.' : 'Nothing was saved. The entry is unchanged.',
      })
      : null,
    button({ label: 'Save changes', kind: 'primary', k: 'save', onClick: () => save(ctx, draw) }),
    button({ label: 'Cancel', kind: 'quiet', k: 'cancel', onClick: () => ctx.back() }),
    edit.isNew ? null : (edit.confirmDelete
      ? deleteEventSheet(ctx, draw)
      : button({
        label: 'Delete event…', kind: 'danger', icon: 'delete', k: 'delete-event',
        onClick: () => { edit.confirmDelete = true; draw(); },
      })),
  ];
}

const hasDetail = event => EVENT_TYPES[event.type].fields.some(f => {
  const v = event[f.key];
  return !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
});

// The chosen type is not clearable — an entry is always something — so tapping
// the selected chip leaves it alone.
function setType(value, draw) {
  const type = value ?? edit.type;
  if (type === edit.type) return;
  edit.type = type;
  // The old type's answers are not shown under the new type's questions: no
  // field means the same thing in two types, so nothing carries across.
  edit.fields = draftFields(type, type === edit.original?.type ? edit.original : null);
  edit.error = '';
  draw();
}

function control(field, draw) {
  const label = FIELD_COPY[`${edit.type}.${field.key}`] ?? field.label;

  if (field.kind === 'text') {
    const box = h('textarea', { rows: 3, k: `f-${field.key}`, 'aria-label': label, placeholder: field.placeholder ?? '' });
    box.value = edit.fields[field.key] ?? '';
    // A draft: it is held here and written by Save, like every other field.
    box.addEventListener('change', () => { edit.fields[field.key] = box.value.trim(); });
    return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), box);
  }

  return chipGroup({
    label,
    name: field.key,
    options: field.options,
    value: edit.fields[field.key],
    multi: field.kind === 'multi',
    exclusive: field.exclusive ?? null,
    onChange: value => { edit.fields[field.key] = value; draw(); },
  });
}

function save(ctx, draw) {
  if (!edit.type) { edit.error = 'Choose what happened.'; draw(); return; }
  const stamp = edit.t ? parseIso(edit.t) : null;
  if (!stamp) { edit.error = 'Add the date and time of this entry.'; draw(); return; }
  if (stamp.ms > ctx.now().getTime()) { edit.error = 'That date and time is in the future.'; draw(); return; }

  const doc = ctx.store.get();
  const toId = nightIdForIso(edit.t);
  const fromId = edit.original ? nightIdForIso(edit.original.t) : null;
  const wasWet = edit.original?.type === 'wet';
  const isWet = edit.type === 'wet';

  const result = ctx.store.update(draft => {
    if (edit.isNew) {
      const ev = newEvent(edit.type, edit.t);
      applyFields(ev);
      insertEvent(ensureNight(draft, toId), ev);
      return;
    }
    const night = nightForEvent(draft, edit.eventId);
    const at = night ? night.events.findIndex(e => e.id === edit.eventId) : -1;
    if (at === -1) return;
    // retypeEvent keeps the id and the stored time; moveEventTo then applies
    // the edited one, re-sorts, and moves the entry between nights.
    const next = retypeEvent(night.events[at], edit.type);
    applyFields(next);
    night.events[at] = next;
    moveEventTo(draft, edit.eventId, edit.t);
  });

  if (!result.ok) { edit.error = 'Not saved'; draw(); return; }

  // Which recorded outcome this save could now contradict: a wet entry
  // arriving on a night, leaving it, or ceasing to be wet. Correcting a wet
  pendingNight = {
    id: toId,
    note: edit.isNew ? 'Entry added' : 'Entry saved',
    undoEvent: null,
  };
  // Replace, not push: backing out of the night must not reopen this draft.
  ctx.navigate(`#/night/${toId}`, { replace: true });
}

function applyFields(ev) {
  for (const f of EVENT_TYPES[edit.type].fields) {
    if (edit.fields[f.key] !== undefined) ev[f.key] = edit.fields[f.key];
  }
}

function deleteEventSheet(ctx, draw) {
  const event = edit.original;
  const label = EVENT_TYPES[event.type]?.label ?? event.type;
  const fromId = nightIdForIso(event.t);
  return sheet(
    h('h3', { text: `Delete ${label} at ${timeLabelFor(event.t)}?` }),
    h('p', { class: 'lead', text: `This removes the entry from the night of ${dayLabelFor(fromId)}.` }),
    button({
      label: 'Delete event', kind: 'danger', k: 'confirm-delete',
      onClick: () => {
        let removed = null;
        const result = ctx.store.update(draft => {
          const night = nightForEvent(draft, event.id);
          if (night) removed = removeEvent(night, event.id);
        });
        if (!result.ok || !removed) {
          edit.error = 'Removal did not save';
          edit.confirmDelete = false;
          draw();
          return;
        }
        pendingNight = {
          id: fromId,
          note: '',
          undoEvent: { nightId: fromId, event: removed },
        };
        ctx.navigate(`#/night/${fromId}`, { replace: true });
      },
    }),
    button({ label: 'Keep event', kind: 'quiet', k: 'cancel-delete', onClick: () => { edit.confirmDelete = false; draw(); } }));
}

/* ── H05 · Add a past night ─────────────────────────────────────────────
   The evening date decides everything, so it is asked for first — and an
   existing date opens its record instead of creating a second one. */

const add = { date: null, error: '' };

export function renderBackfill(el, ctx) {
  add.date = pendingAddDate;
  add.error = '';
  pendingAddDate = null;
  const draw = () => paint(el, backfill(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function backfill(ctx, draw) {
  const doc = ctx.store.get();
  const tonightId = nightIdFor(ctx.now());
  const target = backfillTarget(doc, add.date, ctx.now());

  return [
    title({
      overline: 'History',
      name: 'Add a past night',
      lead: 'Choose the evening the night began.',
    }),
    dateField({
      label: 'Evening date',
      value: add.date,
      max: tonightId,
      onCommit: value => { add.date = value; add.error = ''; draw(); },
    }),
    target.valid
      ? h('p', { class: 'lead', text: `${weekdayNameFor(target.id)} evening → ${weekdayNameFor(dayDateFor(target.id))} morning` })
      : null,
    target.valid && target.future
      ? notice({ kind: 'error', title: 'That evening hasn’t happened yet.', text: 'Choose tonight or an earlier date.' })
      : null,
    add.error ? notice({ kind: 'error', title: add.error, text: NOT_SAVED }) : null,
    // H06's duplicate case: Open existing replaces Create, so one date can
    // never hold two records.
    target.exists
      ? [
        notice({ title: 'This night is already recorded.', text: 'Open it to add or correct details.' }),
        button({ label: 'Open existing night', kind: 'primary', k: 'open-existing', href: `#/night/${target.id}` }),
      ]
      : button({
        label: 'Create night', kind: 'primary', k: 'create',
        onClick: () => create(ctx, target, tonightId, draw),
      }),
  ];
}

function create(ctx, target, tonightId, draw) {
  if (!target.valid) { add.error = 'Choose the evening date first'; draw(); return; }
  if (target.future) { add.error = 'That evening hasn’t happened yet'; draw(); return; }
  const result = ctx.store.update(draft => {
    // Only tonight may become the open night; backfilling an older date must
    // never move logging backwards into it.
    if (target.id === tonightId) openNight(draft, target.id);
    else ensureNight(draft, target.id);
  });
  if (!result.ok) { add.error = 'Not saved'; draw(); return; }
  // The month the new night is in, so it is on screen when History is next
  // opened rather than hidden behind the month arrows.
  state.month = monthOf(target.id);
  ctx.navigate(`#/night/${target.id}`, { replace: true });
}
