// X01–X04: the parent's own routine changes. User-facing name is Routines —
// never "experiments", and never a lab dashboard. This screen records what
// was changed and when, and shows the two equal windows either side of it;
// it never suggests a routine, ranks one, or claims one caused anything.

import { comparison as comparisonChart, textEquivalent } from './charts.js';
import { subnav } from './history.js';
import { lastCompletedNightId, routineComparison } from './metrics.js';
import {
  activeExperiment, assignExperiment, dayLabelFor, endExperiment, isDateStr,
  newExperiment, nightIdFor, openExperiment, prevNightId, removeExperiment,
} from './model.js';
import {
  button, dateField, h, linkRow, notice, paint, sheet, textField, title,
} from './ui.js';

const NOT_SAVED = 'There isn’t enough space to save this change. Try again.';
const NOT_CAUSAL = 'Observed alongside this routine; not proof of cause.';

/* ── Labels ─────────────────────────────────────────────────────────── */

// 'since Tue, 1 September' / 'Tue, 1 September – Sun, 13 September'
function rangeLabel(exp) {
  if (!exp?.from) return '';
  return exp.to ? `${dayLabelFor(exp.from)} – ${dayLabelFor(exp.to)}` : `since ${dayLabelFor(exp.from)}`;
}

// A routine whose first evening has not arrived yet is Scheduled, not
// running: it must not read as if it were already being observed.
function stateOf(exp, now) {
  if (exp?.to) return 'ended';
  return exp && exp.from > nightIdFor(now) ? 'scheduled' : 'ongoing';
}

const stateTag = state =>
  ({ ongoing: 'Ongoing', scheduled: 'Scheduled', ended: 'Ended' })[state] ?? '';

/* ── X01 · The list ─────────────────────────────────────────────────── */

export function render(el, ctx) {
  const draw = () => paint(el, list(ctx));
  draw();
  return ctx.store.subscribe(draw);
}

function list(ctx) {
  const doc = ctx.store.get();
  const now = ctx.now();
  const all = [...doc.experiments].sort((a, b) => (a.from < b.from ? 1 : -1));
  const current = all.filter(e => !e.to);
  const past = all.filter(e => e.to);

  return [
    title({ overline: 'One change at a time', name: 'Routines' }),
    subnav('routines'),
    h('p', { class: 'lead', text: 'Keep a note when you change the evening routine.' }),
    current.length ? h('h3', { text: 'Current' }) : null,
    current.map(exp => routineRow(exp, now)),
    button({
      label: 'Record a change', icon: 'plus', kind: 'primary',
      href: '#/routines/new', k: 'new',
    }),
    past.length ? h('h3', { text: 'Past' }) : null,
    past.map(exp => routineRow(exp, now)),
    all.length ? null : notice({
      title: 'Nothing recorded yet',
      text: 'Use “Record a change” when you choose to try a different routine.',
    }),
  ];
}

function routineRow(exp, now) {
  const state = stateOf(exp, now);
  const sub = state === 'scheduled'
    ? `Scheduled · starts ${dayLabelFor(exp.from)}`
    : rangeLabel(exp);
  return linkRow({ label: exp.name || 'Unnamed routine', sub, href: `#/routines/${exp.id}` });
}

/* ── A name is the one field with no chip group ─────────────────────────
   Commits on change like every other field, and only when the text actually
   changed — focusing and leaving it is not an answer. */

function nameField({ value, onCommit }) {
  const input = h('input', {
    type: 'text', k: 'name', 'aria-label': 'Routine name', value: value ?? '',
    placeholder: 'Earlier lights out', maxlength: '60', enterkeyhint: 'done',
  });
  // Against the last committed value, not the one the field was built with:
  // this form patches its text instead of re-rendering, so the node outlives
  // several commits and clearing the name has to count as one.
  let last = value ?? '';
  input.addEventListener('change', () => {
    const next = input.value.trim();
    if (next === last) return;
    last = next;
    onCommit(next);
  });
  return h('div', { class: 'field' },
    h('span', { class: 'field-label', text: 'Name' }),
    h('div', { class: 'field-row' }, input));
}

/* ── X02 · Create ───────────────────────────────────────────────────────
   The draft lives here rather than in the document: nothing is written
   until Save, so Cancel with unsaved edits is the only thing that needs a
   discard confirmation (handoff rule 7). */

const draft = { name: '', from: null, note: '', error: '', discard: false };

function resetDraft(from) {
  draft.name = '';
  draft.from = from;
  draft.note = '';
  draft.error = '';
  draft.discard = false;
}

const dirty = () => draft.name !== '' || draft.note !== '';

export function renderNew(el, ctx) {
  resetDraft(nightIdFor(ctx.now()));
  const redraw = () => paint(el, createForm(ctx, redraw));
  redraw();
  return ctx.store.subscribe(redraw);
}

/* ── Patching, not redrawing ─────────────────────────────────────────────
   A text or date field commits on the `change` event, which fires on the blur
   of the tap that is already on its way to Save. Redrawing from that handler
   replaces the button under the finger and the tap lands on nothing, so a
   field only updates the draft and rewrites the one line of text that depends
   on it. */

// The error notice of a form, as a node that can be filled and emptied in
// place while the form itself stays put.
function errorSlot(state) {
  const box = h('div');
  const set = msg => {
    state.error = msg;
    box.replaceChildren(...(msg ? [notice({ kind: 'error', title: msg })] : []));
  };
  set(state.error);
  return { box, set };
}

function createForm(ctx, redraw) {
  const doc = ctx.store.get();
  const open = openExperiment(doc);

  if (draft.discard) return discardSheet(ctx, redraw);

  const { box: errorBox, set: setError } = errorSlot(draft);
  // The one line that depends on the name and the start date; both are typed
  // fields, so it is rewritten rather than re-rendered.
  const overlapText = h('p');
  const refreshOverlap = () => {
    if (!open) return;
    // A replacement cannot overlap what it replaces (X04), so the current
    // routine's last evening is the one before this routine's first.
    overlapText.textContent = overlaps(open)
      ? `“${open.name}” started on ${dayLabelFor(open.from)}. A new routine has to start after that.`
      : `“${open.name}” ends on ${dayLabelFor(prevNightId(draft.from))}. `
        + `“${draft.name || 'The new routine'}” starts on ${dayLabelFor(draft.from)}.`;
  };
  refreshOverlap();

  return [
    title({
      overline: 'Routines',
      name: 'Record a change',
      lead: 'A short name is enough to remember what changed.',
    }),
    nameField({ value: draft.name, onCommit: v => { draft.name = v; setError(''); refreshOverlap(); } }),
    dateField({
      label: 'Starts with the night of',
      value: draft.from,
      onCommit: v => { draft.from = v; setError(''); refreshOverlap(); },
      help: 'A date in the future is recorded as Scheduled.',
    }),
    textField({
      label: 'Note', value: draft.note, rows: 3,
      placeholder: 'What changed, in your own words',
      onCommit: v => { draft.note = v; },
    }),
    open ? notice({ title: 'One routine at a time', children: [overlapText] }) : null,
    errorBox,
    button({
      label: open ? 'End current and start new' : 'Save routine',
      kind: 'primary', k: 'save',
      onClick: () => save(ctx, open, setError),
    }),
    button({
      label: 'Cancel', kind: 'quiet', k: 'cancel',
      onClick: () => {
        if (!dirty()) { ctx.back(); return; }
        draft.discard = true;
        redraw();
      },
    }),
  ];
}

function discardSheet(ctx, redraw) {
  return sheet(
    h('h3', { text: 'Discard this routine?' }),
    h('p', { class: 'lead', text: 'Nothing has been recorded yet. The name and note will be lost.' }),
    button({ label: 'Discard', kind: 'danger', k: 'discard', onClick: () => ctx.navigate('#/routines', { replace: true }) }),
    button({
      label: 'Keep editing', kind: 'quiet', k: 'keep',
      onClick: () => { draft.discard = false; redraw(); },
    }),
  );
}

// Read from the draft rather than from render time: the start date can change
// after the form was built, because a field commit no longer redraws it.
const overlaps = open => !!(open && draft.from && draft.from <= open.from);

function save(ctx, open, setError) {
  if (!draft.name.trim()) { setError('Give the change a short name.'); return; }
  if (!isDateStr(draft.from)) { setError('Choose the evening it starts with.'); return; }
  if (overlaps(open)) {
    setError('A new routine has to start after the current one began.');
    return;
  }

  const exp = newExperiment(draft.name, draft.from, draft.note);
  const result = ctx.store.update(d => {
    if (open) endExperiment(d, open.id, prevNightId(draft.from));
    d.experiments.push(exp);
    // Nights already recorded from the start evening onward join it now;
    // nights created later tag themselves through ensureNight.
    assignExperiment(d, exp);
  });
  if (!result.ok) { setError('Not saved'); return; }
  ctx.navigate(`#/routines/${exp.id}`, { replace: true });
}

/* ── X03 · Detail, and X04's end sheet ──────────────────────────────── */

const detail = {
  id: null, editing: false, name: '', from: null, to: null, note: '',
  ending: false, error: '',
};

function resetDetail(exp) {
  detail.id = exp?.id ?? null;
  detail.editing = false;
  detail.name = exp?.name ?? '';
  detail.from = exp?.from ?? null;
  detail.to = exp?.to ?? null;
  detail.note = exp?.note ?? '';
  detail.ending = false;
  detail.error = '';
}

export function renderDetail(el, ctx) {
  const exp = ctx.store.get().experiments.find(e => e.id === ctx.params.id) ?? null;
  resetDetail(exp);
  const redraw = () => paint(el, detailScreen(ctx, redraw));
  redraw();
  return ctx.store.subscribe(redraw);
}

function detailScreen(ctx, redraw) {
  const doc = ctx.store.get();
  const exp = doc.experiments.find(e => e.id === detail.id) ?? null;
  if (!exp) {
    return [
      title({ overline: 'Routines', name: 'Not recorded' }),
      h('p', { class: 'lead', text: 'This routine is no longer in the log.' }),
    ];
  }
  if (detail.editing) return editForm(ctx, exp, redraw);
  if (detail.ending) return endSheet(ctx, exp, redraw);

  const state = stateOf(exp, ctx.now());
  return [
    title({ overline: rangeLabel(exp), name: exp.name || 'Unnamed routine' }),
    exp.note ? h('p', { class: 'lead', text: exp.note }) : null,
    h('span', { class: 'tag', text: stateTag(state) }),
    detail.error ? notice({ kind: 'error', title: detail.error, text: NOT_SAVED }) : null,
    state === 'scheduled'
      ? notice({
        title: 'This routine hasn’t started yet.',
        text: `The comparison appears after the night of ${dayLabelFor(exp.from)}.`,
      })
      : comparisonBlock(doc, exp, ctx.now()),
    linkRow({
      label: 'Edit name, dates or note',
      onClick: () => { detail.editing = true; redraw(); },
      k: 'edit',
    }),
    state === 'scheduled'
      ? linkRow({
        label: 'Remove this routine',
        sub: 'It has no nights yet',
        onClick: () => removeScheduled(ctx, exp, redraw),
        k: 'remove',
      })
      : null,
    // An ended routine has nothing left to end; its dates are changed from
    // Edit, which is where the comparison is redrawn from anyway.
    state === 'ongoing'
      ? linkRow({
        label: 'End this routine…',
        onClick: () => { detail.ending = true; redraw(); },
        k: 'end',
      })
      : null,
  ];
}

// The Before / During windows, straight from metrics.js. Both sample sizes
// are on screen whether or not either arm cleared the threshold — an honest
// limitation is shown at full contrast, never as a dimmed chart.
function comparisonBlock(doc, exp, now) {
  const result = routineComparison(doc, exp, now);
  if (!result.windowNights) {
    return notice({
      title: 'No completed nights yet',
      text: 'The comparison appears once this routine has a completed night.',
    });
  }
  const groups = [
    { key: 'before', label: `Before · ${dayLabelFor(result.before.fromId)} – ${dayLabelFor(result.before.toId)}`, ...result.before },
    { key: 'during', label: `During · ${dayLabelFor(result.during.fromId)} – ${dayLabelFor(result.during.toId)}`, ...result.during },
  ];
  const summary = textEquivalent(result);
  // charts.js hands back an SVG string, dropped into a labelled box the same
  // way Patterns does it — the numbers are also printed below in full.
  const figure = h('div', { role: 'img', 'aria-label': summary });
  figure.innerHTML = comparisonChart({ groups, measure: 'wet', label: summary });

  return [
    h('h3', { text: 'Wet nights' }),
    figure,
    h('p', { class: 'small', text: summary }),
    notice({
      title: `Two equal windows of ${result.windowNights} nights.`,
      text: NOT_CAUSAL,
    }),
  ];
}

function editForm(ctx, exp, redraw) {
  const { box: errorBox, set: setError } = errorSlot(detail);
  return [
    title({ overline: 'Routines', name: 'Edit this routine' }),
    nameField({ value: detail.name, onCommit: v => { detail.name = v; setError(''); } }),
    dateField({
      label: 'Starts with the night of',
      value: detail.from,
      onCommit: v => { detail.from = v; setError(''); },
      help: 'Changing the start date moves which nights are compared.',
    }),
    // Only an ended routine has a last evening to correct; an ongoing one
    // gets its end date from End routine, never typed here.
    exp.to ? dateField({
      label: 'Last included evening',
      value: detail.to,
      onCommit: v => { detail.to = v; setError(''); },
    }) : null,
    textField({
      label: 'Note', value: detail.note, rows: 3,
      onCommit: v => { detail.note = v; },
    }),
    errorBox,
    button({
      label: 'Save changes', kind: 'primary', k: 'save-edit',
      onClick: () => saveEdit(ctx, exp, setError, redraw),
    }),
    button({
      label: 'Cancel', kind: 'quiet', k: 'cancel-edit',
      onClick: () => {
        const changed = detail.name !== exp.name || detail.from !== exp.from
          || detail.to !== exp.to || detail.note !== exp.note;
        if (changed && !confirmDiscard()) return;
        resetDetail(exp);
        redraw();
      },
    }),
  ];
}

// The one place a native confirm is used: an edit draft that is about to be
// thrown away is exactly what handoff rule 7 asks to be confirmed, and it
// cannot gate a logging action.
const confirmDiscard = () => confirm('Discard these changes to the routine?');

function saveEdit(ctx, exp, setError, redraw) {
  if (!detail.name.trim()) { setError('Give the change a short name.'); return; }
  if (!isDateStr(detail.from)) { setError('Choose the evening it starts with.'); return; }
  if (exp.to && (!isDateStr(detail.to) || detail.from > detail.to)) {
    setError('The start has to come before the last included evening.');
    return;
  }
  const next = {
    name: detail.name.trim(), from: detail.from, note: detail.note,
    ...(exp.to ? { to: detail.to } : {}),
  };
  const result = ctx.store.update(d => {
    const target = d.experiments.find(e => e.id === exp.id);
    Object.assign(target, next);
    // Nights that fell out of the new window keep no routine; nights inside
    // it join. Editing the dates is the explicit act that rewrites nights.
    for (const night of d.nights) {
      if (night.experimentId === exp.id) night.experimentId = null;
    }
    assignExperiment(d, target);
    // Anything the edit left uncovered goes back to whichever routine does
    // cover it, rather than silently losing its membership.
    for (const night of d.nights) {
      if (night.experimentId === null) night.experimentId = activeExperiment(d, night.id)?.id ?? null;
    }
  });
  if (!result.ok) { setError('Not saved'); return; }
  detail.error = '';
  detail.editing = false;
  redraw();
}

// X04. The last included evening is the last *completed* night: tonight is
// still being lived, so it cannot be part of a window that is being closed.
function endSheet(ctx, exp, redraw) {
  const lastId = lastCompletedNightId(ctx.now());
  const tooEarly = lastId < exp.from;
  return [
    title({ overline: exp.name, name: 'End this routine?' }),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'Last included evening' }),
      h('div', { class: 'field-value', text: dayLabelFor(lastId) })),
    h('p', { class: 'lead', text: 'The comparison stays in History. New nights will have no routine assigned.' }),
    tooEarly
      ? notice({
        kind: 'error',
        title: 'This routine has no completed nights yet.',
        text: 'Remove it instead, or end it after its first night.',
      })
      : null,
    detail.error ? notice({ kind: 'error', title: detail.error, text: NOT_SAVED }) : null,
    tooEarly ? null : button({
      label: 'End routine', kind: 'primary', k: 'confirm-end',
      onClick: () => end(ctx, exp, lastId, redraw),
    }),
    button({
      label: 'Keep it going', kind: 'quiet', k: 'keep-going',
      onClick: () => { detail.ending = false; detail.error = ''; redraw(); },
    }),
    notice({
      title: 'Starting a different routine?',
      text: 'Record the next change from Routines instead, and this one is ended the evening before it begins.',
    }),
  ];
}

function end(ctx, exp, lastId, redraw) {
  const result = ctx.store.update(d => endExperiment(d, exp.id, lastId));
  if (!result.ok) { detail.error = 'Not saved'; redraw(); return; }
  detail.ending = false;
  redraw();
}

function removeScheduled(ctx, exp, redraw) {
  if (!confirm(`Remove “${exp.name}”? It has no nights recorded yet.`)) return;
  const result = ctx.store.update(d => removeExperiment(d, exp.id));
  if (!result.ok) { detail.error = 'Not saved'; redraw(); return; }
  ctx.navigate('#/routines', { replace: true });
}
