// Shared DOM for every screen. Nothing here reads the store or the document:
// callers pass values in and get a node plus a callback back. Class names
// follow the design atlas (docs/ux/atlas.css) so app.css stays the one place
// the visual system lives.

import {
  composeIso, dateForNightTime, isDateStr, parseIso, stepValue, timeLabelFor,
} from './model.js';

/* ── Element building ───────────────────────────────────────────────────
   `on:click` registers a listener; `k` becomes data-k, which is how a screen
   re-render puts focus back on the control the parent was using. */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on:')) el.addEventListener(key.slice(3), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'hidden') el.hidden = true;
    else if (key === 'value') el.value = value;
    else if (key === 'k') el.dataset.k = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  add(el, children);
  return el;
}

function add(el, children) {
  for (const child of children.flat(6)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child);
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Same-document sprite ids only; they are prefixed i- in index.html.
export function icon(name, cls = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/* ── Text blocks ────────────────────────────────────────────────────────── */

// Overline + serif page title + lead, as one fragment.
export function title({ name, overline, lead }) {
  const frag = document.createDocumentFragment();
  if (overline) frag.append(h('p', { class: 'overline', text: overline }));
  frag.append(h('h2', { text: name }));
  if (lead) frag.append(h('p', { class: 'lead', text: lead }));
  return frag;
}

export function notice({ title: heading, text, kind = '', children = [] }) {
  return h('div', { class: `notice${kind ? ` ${kind}` : ''}`, role: kind === 'error' ? 'alert' : null },
    heading ? h('strong', { text: heading }) : null,
    text ? h('p', { text }) : null,
    children);
}

export function sheet(...children) {
  return h('div', { class: 'sheet' }, children);
}

/* ── Controls ───────────────────────────────────────────────────────────── */

export function button({ label, href, onClick, kind = '', icon: iconName, k }) {
  const cls = `button${kind ? ` ${kind}` : ''}`;
  const kids = [iconName ? icon(iconName) : null, h('span', { text: label })];
  return href
    ? h('a', { class: cls, href, k }, kids)
    : h('button', { class: cls, type: 'button', 'on:click': onClick, k }, kids);
}

export function linkRow({ label, sub, href, onClick, icon: iconName = 'chevron-right', k }) {
  const body = h('span', { text: label }, sub ? h('small', { text: sub }) : null);
  return href
    ? h('a', { class: 'linkrow', href, k }, body, icon(iconName))
    : h('button', { class: 'linkrow', type: 'button', 'on:click': onClick, k }, body, icon(iconName));
}

// The latest saved event, or the empty state. `onOpen` reopens its detail;
// undo is deliberately a plain second button, never hidden behind a swipe.
export function savedStrip({ text, detail, onOpen, onUndo }) {
  const body = h('span', { text }, detail ? h('small', { text: detail }) : null);
  const what = onOpen
    ? h('button', { class: 'what', type: 'button', k: 'strip', 'on:click': onOpen }, icon('check'), body)
    : h('div', { class: 'what' }, body);
  return h('div', { class: `saved${onOpen ? '' : ' empty'}` },
    what,
    onUndo ? h('button', { class: 'undo', type: 'button', k: 'undo', 'on:click': onUndo },
      icon('undo'), h('span', { text: 'Undo' })) : null);
}

/* ── Chips ──────────────────────────────────────────────────────────────
   Unknown must stay reachable: tapping the selected chip clears the field
   back to null. `exclusive` is the option that cannot share a selection
   (sleep signs' "None"). */

export function chipGroup({ label, options, value, multi = false, exclusive = null, reduce = null, onChange, help, name }) {
  const selected = multi ? (Array.isArray(value) ? value : []) : value ?? null;
  const order = options.map(o => o.value);

  const chips = options.map(option => {
    const on = multi ? selected.includes(option.value) : selected === option.value;
    return h('button', {
      class: `chip${on ? ' selected' : ''}`,
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      k: name ? `${name}:${String(option.value)}` : null,
      'on:click': () => onChange(nextValue(option.value, on)),
    }, option.label);
  });

  // `reduce` hands exclusivity to a caller-owned pure function (e.g. sleep
  // signs' toggleSleepSign) so the same rule is exercised by the self-test
  // and by the tap that triggers it, instead of two copies drifting apart.
  function nextValue(value, on) {
    if (reduce) return reduce(selected, value);
    if (!multi) return on ? null : value;
    if (on) return selected.filter(v => v !== value);
    if (exclusive !== null && value === exclusive) return [exclusive];
    return [...selected.filter(v => v !== exclusive), value]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  return h('div', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'chips' }, chips),
    help ? h('p', { class: 'field-help', text: help }) : null);
}

/* ── Time and date ──────────────────────────────────────────────────────
   Native pickers (IMPLEMENTATION.md §1). An empty or unparseable value never
   overwrites the value already committed — handoff rule 5. */

// composeIso returns null for a wall clock that does not exist on that date —
// the hour a spring-forward skips, or an out-of-range typed value. Saying so
// beside the field beats silently recording the hour after it.
const NO_SUCH_TIME = 'This time doesn’t exist on that date. Check it.';

export function timeField({ label, value, dates, onCommit, suggested, help, k = 'time' }) {
  const current = value ? parseIso(value) : null;
  const input = h('input', {
    type: 'time', k, 'aria-label': label, value: current ? current.time : '',
  });
  const error = h('p', { class: 'field-error', role: 'alert' });

  // The model owns the 15:00 boundary; dates[1] is the calendar date a time
  // after midnight belongs to.
  const [evening, next] = Array.isArray(dates) ? dates : [dates, dates];
  const dateFor = time => (dateForNightTime(evening, time) === evening ? evening : next);

  // What the field shows if a later edit is cleared or unparseable: the last
  // value that actually committed, never a guess.
  let shown = current ? current.time : '';

  input.addEventListener('change', () => {
    const time = input.value.slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      // Cleared or half-entered: fall back to the last committed value.
      input.value = shown;
      error.textContent = '';
      return;
    }
    const iso = composeIso(dateFor(time), time);
    // Keep what was typed on screen: coercing it would hide the problem.
    if (!iso) {
      error.textContent = NO_SUCH_TIME;
      return;
    }
    error.textContent = '';
    shown = time;
    onCommit(iso);
  });

  // A suggestion is not a recorded fact until it is tapped (handoff rule 6).
  const hint = suggested && !value
    ? h('p', { class: 'field-help' },
      `Suggested ${timeLabelFor(suggested)} `,
      h('button', { class: 'chip', type: 'button', k: `${k}-use`, 'on:click': () => onCommit(suggested) }, 'Use'))
    : null;

  return h('div', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'field-row' }, input),
    error,
    hint,
    help ? h('p', { class: 'field-help', text: help }) : null);
}

// A date on its own, for the one question that is a date and not an instant:
// which evening a backfilled night began on (H05). Commits the date string,
// never an ISO instant — a night id is a label, not a moment.
export function dateField({ label, value, max, onCommit, help, k = 'date' }) {
  const input = h('input', { type: 'date', k, 'aria-label': label, value: value ?? '', max });
  const error = h('p', { class: 'field-error', role: 'alert' });

  input.addEventListener('change', () => {
    const next = input.value;
    if (next && !isDateStr(next)) { error.textContent = 'Enter a real date.'; return; }
    error.textContent = '';
    onCommit(next || null);
  });

  return h('div', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'field-row' }, input),
    error,
    help ? h('p', { class: 'field-help', text: help }) : null);
}

const FUTURE = 'This event time is in the future. Check its date and time.';

// Date + time together, for moving an event. Rejects a future instant and
// keeps what was typed on screen — never coerces it to something valid.
// `preview` turns the half-typed value into a line of text (the destination
// night); it is written straight into this field's own node, because a screen
// re-render here would rebuild the input under the parent's finger.
export function dateTimeField({ label, value, onCommit, preview, now = () => new Date(), help }) {
  const current = value ? parseIso(value) : null;
  const dateInput = h('input', { type: 'date', k: 'date', 'aria-label': `${label} date`, value: current ? current.date : '' });
  const timeInput = h('input', { type: 'time', k: 'time', 'aria-label': `${label} time`, value: current ? current.time : '' });
  const error = h('p', { class: 'field-error', role: 'alert' });
  const note = h('p', { class: 'field-help' });

  const entered = () => composeIso(dateInput.value, timeInput.value.slice(0, 5));

  const commit = () => {
    const iso = entered();
    if (!iso) {
      const half = !dateInput.value || !timeInput.value;
      error.textContent = half ? 'Enter both a date and a time.' : NO_SUCH_TIME;
      return;
    }
    if (parseIso(iso).ms > now().getTime()) { error.textContent = FUTURE; return; }
    error.textContent = '';
    onCommit(iso);
  };

  for (const input of [dateInput, timeInput]) {
    input.addEventListener('change', commit);
    if (preview) input.addEventListener('input', () => { note.textContent = preview(entered()); });
  }
  if (preview) note.textContent = preview(entered());

  return h('div', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'field-row' }, dateInput, timeInput),
    error,
    note,
    help ? h('p', { class: 'field-help', text: help }) : null);
}

/* ── Stepper ────────────────────────────────────────────────────────────
   Unset until someone answers: the first tap on either button answers `min`,
   so a count of zero is reachable without passing through one. */

export function stepper({ label, value, min = 0, onChange, help }) {
  const set = delta => onChange(stepValue(value, min, delta));

  return h('div', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'stepper' },
      h('button', { class: 'chip', type: 'button', k: 'minus', 'aria-label': `${label} down`, 'on:click': () => set(-1) }, icon('minus')),
      h('span', { class: 'stepper-value', text: value === null || value === undefined ? 'Not added' : String(value) }),
      h('button', { class: 'chip', type: 'button', k: 'plus', 'aria-label': `${label} up`, 'on:click': () => set(1) }, icon('plus'))),
    help ? h('p', { class: 'field-help', text: help }) : null);
}

/* ── Text and checkbox ──────────────────────────────────────────────────
   Free text and a boolean, for the fields no chip group fits (a note, or
   asleepEstimated — which is true/false, never the null "unknown" a chip
   group would clear it to). */

// Commits on blur/change, like a chip — but only when the content actually
// changed, or focusing and leaving a field would count as answering it.
export function textField({ label, value, placeholder = '', rows = 3, onCommit, k = 'note' }) {
  const box = h('textarea', { rows, k, 'aria-label': label, placeholder });
  box.value = value ?? '';
  // Compared against the last value this field committed, not the one it was
  // built with: a screen that patches text instead of re-rendering keeps the
  // same node, and clearing a note back to empty is still an answer.
  let last = value ?? '';
  box.addEventListener('change', () => {
    const next = box.value.trim();
    if (next === last) return;
    last = next;
    onCommit(next);
  });
  return h('div', { class: 'field' }, h('span', { class: 'field-label', text: label }), box);
}

export function checkbox({ label, checked, onChange, k = 'check' }) {
  return h('label', { class: 'checkbox' },
    h('input', { type: 'checkbox', k, checked: checked || null, 'on:change': e => onChange(e.target.checked) }),
    h('span', { text: label }));
}

/* ── Painting ───────────────────────────────────────────────────────────
   A screen redraws by replacing its children. Focus is carried across on the
   data-k key so a re-render does not drop the control under a finger.  */

export function paint(el, nodes) {
  const active = document.activeElement;
  const key = active && el.contains(active) ? active.dataset.k : null;
  el.replaceChildren(...[nodes].flat(6).filter(n => n !== null && n !== undefined && n !== false));
  if (key) el.querySelector(`[data-k="${CSS.escape(key)}"]`)?.focus();
}
