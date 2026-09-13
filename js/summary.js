// O02: the one-page sheet for the pediatrician, and the only light surface in
// the app. It is reached only by asking for it (More → Export & summary →
// Printable summary), never by the app brightening itself.
//
// Every figure keeps its denominator beside it, and nothing here interprets:
// no diagnosis, no recommendation, no score, no "better" or "worse".

import {
  askedToPee, coverage, firstWetting, nightsInRange, noticed,
  routineComparison, wetNights, wettingsPerWetNight,
} from './metrics.js';
import { exportRange } from './backup.js';
import { activeExperiment, dayLabelFor, prevNightId } from './model.js';
import { button, h, linkRow, paint, title } from './ui.js';

/* ── The numbers ────────────────────────────────────────────────────────
   Pure. metrics.js owns every denominator; this only adds the tallies the
   sheet needs that no chart asks for — daytime answers, bowel categories
   and sleep signs — and each of those carries its own answered count. */

const answered = v => v !== null && v !== undefined;

function daytimeSummary(nights) {
  const out = {
    days: 0,
    urgency: { answered: 0, yes: 0 },
    holding: { answered: 0, yes: 0 },
    accidents: { answered: 0, days: 0, total: 0 },
    toilet: { answered: 0, min: null, max: null },
  };
  for (const night of nights) {
    const day = night.day ?? {};
    if (!Object.values(day).some(answered)) continue;
    out.days++;
    for (const key of ['urgency', 'holding']) {
      if (day[key] === true || day[key] === false) {
        out[key].answered++;
        if (day[key] === true) out[key].yes++;
      }
    }
    if (answered(day.accidents)) {
      out.accidents.answered++;
      out.accidents.total += day.accidents;
      if (day.accidents > 0) out.accidents.days++;
    }
    if (answered(day.toiletCount)) {
      out.toilet.answered++;
      out.toilet.min = out.toilet.min === null ? day.toiletCount : Math.min(out.toilet.min, day.toiletCount);
      out.toilet.max = out.toilet.max === null ? day.toiletCount : Math.max(out.toilet.max, day.toiletCount);
    }
  }
  return out;
}

// The daytime that precedes a night is the night before's `day` block, so the
// bowel tally is read the same way the overlay reads it (DESIGN.md §3).
function bowelSummary(doc, nights) {
  const counts = { none: 0, hard: 0, normal: 0, loose: 0 };
  let recorded = 0;
  for (const night of nights) {
    const previous = doc.nights.find(n => n.id === prevNightId(night.id));
    const stool = previous?.day?.stool ?? null;
    if (stool === null || !(stool in counts)) continue;
    counts[stool]++;
    recorded++;
  }
  return { recorded, missing: nights.length - recorded, counts };
}

function sleepSummary(nights) {
  const out = { answered: 0, snoring: 0, 'mouth-breathing': 0, restless: 0, none: 0 };
  for (const night of nights) {
    const signs = night.morning?.sleepSigns ?? null;
    if (!Array.isArray(signs) || !signs.length) continue;
    out.answered++;
    for (const sign of signs) if (sign in out) out[sign]++;
  }
  return out;
}

export function summaryData(doc, fromId, toId, now = new Date()) {
  const nights = nightsInRange(doc, fromId, toId);
  const routine = activeExperiment(doc, toId)
    ?? [...(doc.experiments ?? [])].filter(e => !e.to || e.to >= fromId).pop()
    ?? null;
  return {
    fromId,
    toId,
    nights: nights.length,
    // A document with nothing in it is the design specimen, not a record of
    // anyone's nights — the sheet says so rather than looking like a real one.
    sample: !doc.nights.length,
    coverage: coverage(nights),
    wet: wetNights(nights),
    first: firstWetting(nights),
    asked: askedToPee(nights),
    noticed: noticed(nights),
    perNight: wettingsPerWetNight(nights),
    daytime: daytimeSummary(nights),
    bowel: bowelSummary(doc, nights),
    sleep: sleepSummary(nights),
    routine,
    routineComparison: routine ? routineComparison(doc, routine, now) : null,
  };
}

/* ── The screen ─────────────────────────────────────────────────────── */

// Session-only and length-capped: a long note belongs in the letter, not
// squeezed onto this page in smaller type (UX-HANDOFF O02).
const NOTE_MAX = 400;
let parentNote = '';

export function render(el, ctx) {
  const redraw = () => paint(el, screen(ctx));
  redraw();
  return ctx.store.subscribe(redraw);
}

function screen(ctx) {
  const doc = ctx.store.get();
  const { fromId, toId } = exportRange(doc, ctx.now());
  const data = summaryData(doc, fromId, toId, ctx.now());

  const note = h('textarea', {
    rows: 3, k: 'parent-note', maxlength: String(NOTE_MAX),
    'aria-label': 'Parent note',
    placeholder: 'Anything you want the sheet to say',
  });
  note.value = parentNote;
  // The note's `change` fires on the blur of the tap that is already heading
  // for Print. Redrawing here would replace that button before the tap landed,
  // so only the sheet's own note block is rewritten.
  const noteBlock = h('div', { class: 'parent-note' });
  const paintNote = () => noteBlock.replaceChildren(...(parentNote
    ? [h('h2', { text: 'Parent note' }), h('div', { class: 'note', text: parentNote })]
    : []));
  note.addEventListener('change', () => { parentNote = note.value.trim(); paintNote(); });
  paintNote();

  return [
    title({
      overline: 'Summary sheet',
      name: 'A night-by-night picture',
      lead: `${dayLabelFor(fromId)} – ${dayLabelFor(toId)} · this page is a print preview, `
        + 'and the only light screen in the app.',
    }),
    h('div', { class: 'field' },
      h('span', { class: 'field-label', text: 'Include a parent note' }),
      note),
    button({
      label: 'Print / Save as PDF', kind: 'primary', icon: 'print', k: 'print',
      onClick: () => window.print(),
    }),
    sheetFor(data, noteBlock),
    linkRow({ label: 'Change the date range', href: '#/more/export', k: 'range' }),
    linkRow({ label: 'Back to More', href: '#/more', k: 'back' }),
  ];
}

const pct = x => `${Math.round(x * 100)}%`;
const of = (n, d) => `${n} of ${d}`;

function figure(label, value, sub) {
  return h('div', { class: 'figure' },
    h('span', { text: label }),
    h('b', { text: value }),
    h('small', { text: sub }));
}

function rows(pairs) {
  return h('table', {}, h('tbody', {},
    pairs.filter(Boolean).map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: v })))));
}

function notes(items) {
  return h('ul', { class: 'notes' }, items.filter(Boolean).map(item =>
    (Array.isArray(item)
      ? h('li', {}, h('strong', { text: item[0] }), ` ${item[1]}`)
      : h('li', { text: item }))));
}

function sheetFor(d, noteBlock) {
  const { wet, first, asked, noticed: seen, perNight, daytime, bowel, sleep } = d;
  const routineWindow = d.routineComparison;

  return h('article', { class: 'summary' },
    h('header', { class: 'summary-head' },
      h('span', { class: 'brand', text: 'peelog' }),
      d.sample ? h('span', { class: 'sample', text: 'SAMPLE · NO RECORDS YET' }) : null),
    h('h1', { text: 'A night-by-night picture' }),
    h('p', { class: 'period', text: `${dayLabelFor(d.fromId)} – ${dayLabelFor(d.toId)} · nights dated by their evening` }),
    h('div', { class: 'summary-coverage' },
      h('b', { text: `${of(d.coverage.reviewed, d.coverage.total)} nights reviewed.` }),
      ` ${d.coverage.unreviewed} incomplete night${d.coverage.unreviewed === 1 ? '' : 's'} excluded from `
      + 'finalised outcome rates. An empty record does not mean a dry night.'),

    h('div', { class: 'figures' },
      figure('Wet nights', of(wet.wet, wet.reviewed),
        wet.rate === null
          ? 'Not enough reviewed nights for a rate'
          : `${pct(wet.rate)} · ${wet.ratePerWeek} per week, normalised`),
      figure('Asked to pee', of(asked.nights, asked.reviewed), 'Nights with child-initiated toileting'),
      figure('First wetting after sleep',
        first.median === null ? 'No record' : `${first.median} hours`,
        first.median === null
          ? 'Needs an asleep time and a wet entry'
          : `Median · ${first.eligible} eligible night${first.eligible === 1 ? '' : 's'}`)),

    h('h2', { text: 'Nighttime observations' }),
    rows([
      ['Wettings per wet night with event detail',
        perNight.nights ? `${perNight.events} events / ${perNight.nights} nights = ${perNight.mean}` : 'No record'],
      ['Woke and noticed the wetting',
        seen.known ? `${of(seen.self, seen.known)} known events · ${seen.unknown} unknown` : 'No record'],
      ['Wet nights missing event detail', `${perNight.excludedNoEvents} of ${wet.wet} wet nights`],
      ['Nights with a wet entry but no review', String(wet.excludedReviewDue)],
    ]),

    h('div', { class: 'twocol' },
      h('section', {},
        h('h2', { text: 'Daytime observations' }),
        notes([
          ['Days with daytime answers:', String(daytime.days)],
          `Urgency reported on ${of(daytime.urgency.yes, daytime.urgency.answered)} days with an answer`,
          `Holding reported on ${of(daytime.holding.yes, daytime.holding.answered)} days with an answer`,
          `Accidents on ${of(daytime.accidents.days, daytime.accidents.answered)} days · `
            + `${daytime.accidents.total} in total`,
          daytime.toilet.answered
            ? `Toilet visits: ${daytime.toilet.min}–${daytime.toilet.max} per day, `
              + `${daytime.toilet.answered} known days`
            : 'Toilet visits: no record',
        ])),
      h('section', {},
        h('h2', { text: 'Bowel pattern' }),
        notes([
          ['Nights with a recorded answer for the day before:', String(bowel.recorded)],
          `Normal: ${bowel.counts.normal} · Hard: ${bowel.counts.hard}`,
          `None: ${bowel.counts.none} · Loose: ${bowel.counts.loose}`,
          `Missing bowel answers: ${bowel.missing} nights`,
          'None means explicitly no bowel movement.',
        ]))),

    h('div', { class: 'twocol' },
      h('section', {},
        h('h2', { text: 'Sleep signs' }),
        notes([
          ['Nights with sleep-sign answers:', String(sleep.answered)],
          `Snoring: ${of(sleep.snoring, sleep.answered)} nights`,
          `Mouth breathing: ${of(sleep['mouth-breathing'], sleep.answered)} nights`,
          `Restlessness: ${of(sleep.restless, sleep.answered)} nights`,
          `No signs noted: ${of(sleep.none, sleep.answered)} nights`,
        ])),
      h('section', {},
        h('h2', { text: 'Recorded routine' }),
        d.routine
          ? notes([
            [d.routine.name, d.routine.to
              ? `· ${dayLabelFor(d.routine.from)} – ${dayLabelFor(d.routine.to)}`
              : `· since ${dayLabelFor(d.routine.from)}`],
            routineWindow?.windowNights
              ? `Before, ${dayLabelFor(routineWindow.before.fromId)} – ${dayLabelFor(routineWindow.before.toId)}: `
                + `${of(routineWindow.before.wet, routineWindow.before.reviewed)} nights wet`
              : 'No completed nights in this routine yet',
            routineWindow?.windowNights
              ? `During, ${dayLabelFor(routineWindow.during.fromId)} – ${dayLabelFor(routineWindow.during.toId)}: `
                + `${of(routineWindow.during.wet, routineWindow.during.reviewed)} nights wet`
              : null,
            routineWindow?.windowNights
              ? `${routineWindow.windowNights} calendar nights per window`
              : null,
            'Observed alongside the routine, not proof of cause.',
          ])
          : notes(['No routine change recorded in this period.']))),

    noteBlock,

    h('footer', { class: 'foot' },
      h('p', { text: 'Parent-recorded observations only. Missing answers are omitted from the '
        + 'relevant denominator. This summary contains no diagnosis or treatment recommendation.' }),
      h('p', { text: 'PeeLog · records kept on one phone · nights dated by their evening' })));
}
