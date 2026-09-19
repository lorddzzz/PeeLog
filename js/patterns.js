// P01–P03: History → Patterns. Every number on this screen comes straight
// from metrics.js, and every chart from charts.js — this file only lays them
// out, picks the period, and formats dates. It never computes a rate, a
// denominator, or decides what counts as enough (UX-HANDOFF §P01–P03).
//
// No causal claims, no "better/worse" arrows, no dimmed chart for a result
// below the sample threshold: an insufficient result still gets its real
// counts, in normal contrast, with a plain "not enough recorded nights" line.

import {
  askedToPee, bowelComparison, coverage, drinksComparison, firstWetting,
  lastToiletComparison, liftComparison, nightsInRange, noticed, rangeFor,
  wetNights, wetNightsByWeek, wettingsPerWetNight,
} from './metrics.js';
import { barSeries, comparison, dotPlot, textEquivalent } from './charts.js';
import { dayLabelFor } from './model.js';
import { h, paint, title } from './ui.js';
import { subnav } from './history.js';

// Matches the wording charts.js already uses below the sample threshold, so
// the screen never invents a second phrasing for the same idea.
const INSUFFICIENT = 'Not enough recorded nights for a comparison yet';

/* ── Screen state ───────────────────────────────────────────────────────
   Session-only: which period is on screen survives a re-render (a store
   update elsewhere) but always starts at 28 days on a fresh visit. */

let period = '28d';

export function render(el, ctx) {
  const draw = () => paint(el, screen(ctx, draw));
  draw();
  return ctx.store.subscribe(draw);
}

function screen(ctx, draw) {
  const doc = ctx.store.get();
  const range = rangeFor(period, ctx.now());
  const nights = nightsInRange(doc, range.fromId, range.toId);
  const cov = coverage(nights);

  return [
    title({
      overline: 'Patterns',
      name: 'Patterns',
      lead: 'Counts and comparisons from what you’ve recorded, with the sample size shown beside every figure.',
    }),
    subnav('patterns'),
    periodChips(draw),
    h('p', { class: 'context', text: `${shortDayLabel(range.fromId)} – ${shortDayLabel(range.toId)}` }),
    h('p', { text: coverageLine(cov) }),
    wetNightsMetric(nights, range),
    firstWettingMetric(nights),
    wettingsMetric(nights),
    noticedMetric(nights),
    askedMetric(nights),
    comparisonMetric({ heading: 'Evening drinks', result: drinksComparison(nights), measure: 'wet' }),
    comparisonMetric({ heading: 'Last toilet before sleep', result: lastToiletComparison(nights), measure: 'wet' }),
    comparisonMetric({ heading: 'Lifts', result: liftComparison(nights), measure: 'dry' }),
    comparisonMetric({ heading: 'Bowel pattern', result: bowelComparison(nights, doc), measure: 'wet' }),
  ];
}

/* ── Period and date range ─────────────────────────────────────────────── */

function periodChips(draw) {
  return h('div', { class: 'chips' }, [['7d', '7 days'], ['28d', '28 days']].map(([value, label]) =>
    h('button', {
      class: `chip${period === value ? ' selected' : ''}`,
      type: 'button',
      k: `period-${value}`,
      'aria-pressed': period === value ? 'true' : 'false',
      'on:click': () => { period = value; draw(); },
    }, label)));
}

// dayLabelFor gives 'Sun, 17 August'; the period line has no room for the
// full month name, and the weekday is dropped again for a bar's x-axis label.
const shortDayLabel = dateStr => dayLabelFor(dateStr).replace(/[A-Za-z]+$/, m => m.slice(0, 3));
const shortMonthDay = dateStr => shortDayLabel(dateStr).replace(/^\w+,\s*/, '');

const nightsWord = n => `${n} night${n === 1 ? '' : 's'}`;
const pct = r => `${Math.round(r * 100)}%`;

function coverageLine(c) {
  if (!c.total) return 'No nights recorded in this period.';
  let line = `${c.reviewed} of ${nightsWord(c.total)} reviewed`;
  if (c.unreviewed) line += ` · ${c.unreviewed} incomplete`;
  return line;
}

/* ── Exclusions ─────────────────────────────────────────────────────────
   Same reasons metrics.js hands back everywhere, spelled out once here so
   every metric block can name what it left out and why (UX-HANDOFF §P01–P03:
   "Label ... incomplete records, and missing inputs"). */

const EXCLUDE_REASON = {
  unreviewed: 'no wake time recorded',
  reviewDue: 'no wake time recorded',
  unknown: 'not classifiable',
  unknownDrinks: 'no drinks recorded',
  noDinner: 'no dinner time',
  unknownDrinkTime: 'a drink with no time',
  unknownDrinkSize: 'a drink with no amount',
  unknownTimes: 'a missing toilet or asleep time',
  invalidOrder: 'times out of order',
  incompleteRecord: 'an event record not confirmed complete',
  noRecord: 'no bowel record for the day before',
  noAsleep: 'no asleep time',
  noWet: 'no event detail on a wet night',
  noEvents: 'no event detail on a wet night',
};

function excludedLine(excluded, unit = 'night') {
  const parts = Object.entries(excluded ?? {}).filter(([, n]) => n > 0);
  if (!parts.length) return null;
  const total = parts.reduce((sum, [, n]) => sum + n, 0);
  const reasons = parts.map(([reason, n]) => `${n} for ${EXCLUDE_REASON[reason] ?? reason}`);
  const list = reasons.length === 1
    ? reasons[0]
    : `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`;
  return `${total} ${unit}${total === 1 ? '' : 's'} excluded: ${list}.`;
}

/* ── Metric block ───────────────────────────────────────────────────────
   One shape for every question: heading, serif figure, a denominator line,
   an optional chart (an SVG string dropped in as a labelled image), the
   text equivalent charts.js already builds, and what was left out. */

function metricBlock({ heading, value, denom, chartHtml, ariaLabel, result, excludedText, extraClass = '' }) {
  let figure = null;
  if (chartHtml) {
    figure = h('div', { role: 'img', 'aria-label': ariaLabel });
    figure.innerHTML = chartHtml;
  }
  return h('div', { class: `metric${extraClass ? ` ${extraClass}` : ''}` },
    h('h3', { text: heading }),
    h('p', { class: 'value', text: value }),
    denom ? h('p', { text: denom }) : null,
    figure,
    h('p', { class: 'small', text: textEquivalent(result) }),
    excludedText ? h('p', { class: 'small', text: excludedText }) : null);
}

/* ── Wet nights ─────────────────────────────────────────────────────────
   The one metric with two shapes: a 7-day window can never reach the
   10-night threshold, so that view states direct counts and stops — no
   rate, no "not enough" caveat, because a week was never meant to carry one
   (UX-HANDOFF §P01–P03, the 7-day count exception). */

function wetNightsMetric(nights, range) {
  const w = wetNights(nights);

  if (range.period === '7d') {
    const value = `${w.wet} wet of ${nightsWord(w.reviewed)} reviewed`;
    const denom = w.unreviewed ? `${w.unreviewed} with no wake time recorded` : null;
    return h('div', { class: 'metric' },
      h('h3', { text: 'Wet nights' }),
      h('p', { class: 'value', text: value }),
      denom ? h('p', { text: denom }) : null,
      h('p', { class: 'small', text: 'A week is too short to normalise into a rate, so this is a direct count.' }));
  }

  const weeks = wetNightsByWeek(nights, range.toId, 4);
  const chartHtml = barSeries({
    values: weeks.weeks.map(wk => ({ label: shortMonthDay(wk.fromId), value: wk.wet, kind: 'wet', n: wk.reviewed })),
    label: textEquivalent(weeks),
  });
  const value = w.insufficient ? `${w.wet} wet of ${nightsWord(w.reviewed)} reviewed` : pct(w.rate);
  const denom = w.insufficient
    ? INSUFFICIENT
    : `${w.wet} of ${w.reviewed} reviewed · ${w.ratePerWeek} wet nights per week`;

  return metricBlock({
    heading: 'Wet nights', value, denom, chartHtml, ariaLabel: textEquivalent(weeks), result: w,
  });
}

/* ── Timing ─────────────────────────────────────────────────────────────
   Hours after falling asleep, never clock time — see metrics.js. */

function firstWettingMetric(nights) {
  const f = firstWetting(nights);
  const value = f.points.length ? `${f.median} h` : 'No data yet';
  const denom = f.points.length ? `Median across ${nightsWord(f.points.length)}` : null;
  const chartHtml = dotPlot({
    points: f.points.map(p => ({ label: p.id, value: p.hours })),
    unit: 'h',
    axisLabels: { left: 'Earlier nights', right: 'Recent nights' },
    label: textEquivalent(f),
  });
  return metricBlock({
    heading: 'First wetting after sleep', value, denom, chartHtml, ariaLabel: textEquivalent(f), result: f,
    excludedText: excludedLine(f.excluded),
  });
}

// No chart: a single mean has nothing left to plot once its own figure is on
// screen, and the atlas study agrees (P02 shows this one as text only).
function wettingsMetric(nights) {
  const w = wettingsPerWetNight(nights);
  const value = w.nights ? `${w.mean}` : 'No data yet';
  const denom = w.nights
    ? `${w.events} wettings across ${nightsWord(w.nights)} with event detail`
    : 'No wet nights with event detail yet';
  return metricBlock({
    heading: 'Wettings per wet night', value, denom, result: w, excludedText: excludedLine(w.excluded),
  });
}

/* ── Arousal and initiative ─────────────────────────────────────────────
   Both text-only, matching the atlas study — a self/parent split or a
   single share has no chart shape in charts.js that would not misstate what
   it measures. */

function noticedMetric(nights) {
  const n = noticed(nights);
  const value = n.insufficient ? `${n.self} of ${n.known}` : pct(n.share);
  const denom = n.insufficient ? INSUFFICIENT : `${n.self} of ${n.known} wet events with a noticed answer recorded`;
  return metricBlock({
    heading: 'Woke and noticed', value, denom, result: n,
    excludedText: n.unknown ? `${n.unknown} event${n.unknown === 1 ? '' : 's'} have no answer recorded.` : null,
  });
}

function askedMetric(nights) {
  const a = askedToPee(nights);
  const value = a.insufficient ? `${a.nights} of ${nightsWord(a.reviewed)}` : pct(a.share);
  const denom = a.insufficient ? INSUFFICIENT : `${a.nights} of ${a.reviewed} reviewed nights`;
  return metricBlock({
    heading: 'Asked to pee', value, denom, result: a, excludedText: excludedLine(a.excluded),
  });
}

/* ── Comparisons ────────────────────────────────────────────────────────
   Drinks, last toilet, lifts, bowel pattern: all one shape from metrics.js's
   own compare(), so one renderer covers all four. */

function comparisonMetric({ heading, result, measure }) {
  const chartHtml = comparison({ groups: result.groups, measure, label: textEquivalent(result) });
  return metricBlock({
    heading,
    // The hero figure of a comparison is a sample size, not a measurement: a
    // bare "28" under "Evening drinks" reads as 28 drinks.
    value: nightsWord(result.eligible),
    denom: 'Eligible for comparison',
    chartHtml,
    ariaLabel: textEquivalent(result),
    result,
    excludedText: excludedLine(result.excluded),
    extraClass: 'comparison',
  });
}
