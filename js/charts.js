// Hand-rolled SVG. No chart library — these are three simple plots, and a
// dependency would cost more than it saves for an offline app with no build
// step (DESIGN.md §5, AGENTS.md rule 2).
//
// Every builder is pure: it takes numbers that metrics.js already computed and
// returns an SVG *string*. Nothing here reads the document, and nothing here
// decides what a figure means.
//
// Colour is never the only carrier of meaning: every bar, dot group and
// comparison arm is labelled in text, and `textEquivalent` renders the same
// numbers as a sentence for VoiceOver and for anywhere the SVG does not draw.
//
// Classes, not hex: `.c-wet` (clay — wetting), `.c-timing` (slate — timing),
// `.c-axis`, `.c-label`. Shapes fill and stroke with `currentColor`, so app.css
// sets `color` on those four classes and nothing here needs to know the
// palette.

/* ── Geometry ───────────────────────────────────────────────────────────
   The coordinate space is 100 units wide and the <svg> is sized by CSS, so
   the charts are responsive. That means type has to be sized in user units
   too: the content column is ~333 px on the target phone, so 3.6 units is
   the 12 px the handoff asks for. app.css can override it on `.c-label` if
   the column ever changes width. */

const W = 100;
const LABEL = 3.6;
const SUB = 3;

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const pct = r => `${Math.round(r * 100)}%`;

// 3.5 not 3.50, 2 not 2.0 — the figures are read at a glance.
const num = x => String(Math.round(x * 100) / 100);

const svg = (height, aria, body) =>
  `<svg class="chart" viewBox="0 0 ${W} ${num(height)}" width="100%" `
  + `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(aria)}">${body}</svg>`;

const text = (x, y, cls, anchor, size, s) =>
  `<text class="${cls}" x="${num(x)}" y="${num(y)}" text-anchor="${anchor}" `
  + `font-size="${num(size)}" fill="currentColor">${esc(s)}</text>`;

// Nothing to draw is still something to say — an empty box would read as a
// rendering failure rather than as an honest gap.
const emptyChart = message => svg(12, message, text(W / 2, 7.5, 'c-label', 'middle', LABEL, message));

/* ── Bar series ─────────────────────────────────────────────────────────
   Weekly wet-night counts. Each bar carries its own n, because four bars
   over four different denominators are not comparable without it. */

export function barSeries({ values = [], max = null, height = 44, label = null } = {}) {
  if (!values.length) return emptyChart('No nights recorded yet');

  const hasN = values.some(v => v.n !== null && v.n !== undefined);
  const yTop = LABEL + 1.6;
  const yBottom = height - (LABEL + 1.4 + (hasN ? SUB + 1 : 0));
  const plot = Math.max(1, yBottom - yTop);
  const top = max ?? Math.max(...values.map(v => v.value ?? 0), 1) ?? 1;
  const slot = W / values.length;
  const barW = Math.min(slot * 0.6, 14);

  let body = `<line class="c-axis" x1="0" y1="${num(yBottom)}" x2="${W}" y2="${num(yBottom)}" `
    + 'stroke="currentColor" stroke-width="0.3"/>';

  values.forEach((v, i) => {
    const value = v.value ?? 0;
    const mid = slot * i + slot / 2;
    const h = top > 0 ? (value / top) * plot : 0;
    // A zero stays a zero: no minimum stub, because a visible bar would read
    // as a small count rather than none. The printed value carries it.
    if (h > 0) {
      body += `<rect class="c-${v.kind === 'timing' ? 'timing' : 'wet'}" `
        + `x="${num(mid - barW / 2)}" y="${num(yBottom - h)}" width="${num(barW)}" `
        + `height="${num(h)}" rx="0.8" fill="currentColor"/>`;
    }
    body += text(mid, Math.max(LABEL, yBottom - h - 1.2), 'c-label', 'middle', LABEL, num(value));
    body += text(mid, yBottom + LABEL + 1.2, 'c-label', 'middle', LABEL, v.label ?? '');
    if (hasN && v.n !== null && v.n !== undefined) {
      body += text(mid, yBottom + LABEL + 1.2 + SUB + 0.8, 'c-axis', 'middle', SUB, `n=${v.n}`);
    }
  });

  const aria = label ?? `Bar chart. ${values.map(v => `${v.label ?? ''} ${num(v.value ?? 0)}`
    + (v.n === null || v.n === undefined ? '' : ` of ${v.n}`)).join(', ')}.`;
  return svg(height, aria, body);
}

/* ── Dot plot ───────────────────────────────────────────────────────────
   Hours after falling asleep, one dot per night, oldest to most recent.
   Hours, not clock time: 02:00 means something different after a 19:30
   bedtime than after a 21:30 one. */

export function dotPlot({ points = [], unit = 'h', height = 52, axisLabels = null, label = null } = {}) {
  if (!points.length) return emptyChart('No nights with timing yet');

  const gutter = 12;
  const yTop = 3;
  const yBottom = height - (LABEL + 3);
  const vals = points.map(p => p.value ?? 0);
  const lo = Math.floor(Math.min(...vals));
  const hi = Math.max(Math.ceil(Math.max(...vals)), lo + 1);
  // The band is inset from the axis so a dot at the lowest value sits clear of
  // the baseline instead of looking like part of it.
  const yLo = yBottom - 2.4;
  const yHi = yTop + 1.6;
  const y = v => yLo - ((v - lo) / (hi - lo)) * (yLo - yHi);

  let body = `<path class="c-axis" d="M${num(gutter)} ${num(yTop)}V${num(yBottom)}H${W - 1}" `
    + 'fill="none" stroke="currentColor" stroke-width="0.3"/>';

  for (const tick of [hi, (lo + hi) / 2, lo]) {
    body += text(gutter - 1.5, y(tick) + LABEL * 0.35, 'c-axis', 'end', LABEL, `${num(tick)} ${unit}`);
  }

  const left = gutter + 3;
  const right = W - 3;
  const step = points.length > 1 ? (right - left) / (points.length - 1) : 0;
  points.forEach((p, i) => {
    const x = points.length > 1 ? left + i * step : (left + right) / 2;
    body += `<circle class="c-timing" cx="${num(x)}" cy="${num(y(p.value ?? 0))}" r="1.5" fill="currentColor"/>`;
  });

  const ends = axisLabels ?? { left: points[0]?.label ?? '', right: points[points.length - 1]?.label ?? '' };
  if (ends.left) body += text(gutter, height - 0.6, 'c-label', 'start', LABEL, ends.left);
  if (ends.right && points.length > 1) body += text(W, height - 0.6, 'c-label', 'end', LABEL, ends.right);

  const aria = label ?? `Dot plot of ${points.length} night${points.length === 1 ? '' : 's'}, `
    + `${num(Math.min(...vals))} to ${num(Math.max(...vals))} ${unit === 'h' ? 'hours' : unit}.`;
  return svg(height, aria, body);
}

/* ── Comparison ─────────────────────────────────────────────────────────
   One horizontal bar per group, each with its own denominator on the line
   below it. A group under the threshold draws no bar and says so — never a
   dimmed bar, which makes an honest limitation look like a rendering bug. */

const INSUFFICIENT = 'Not enough recorded nights for a comparison yet';

export function comparison({ groups = [], measure = 'wet', label = null } = {}) {
  if (!groups.length) return emptyChart('Nothing recorded to compare yet');

  // SVG text does not wrap, so a group that has to carry the insufficiency
  // message gets a taller row and a second line rather than a clipped one.
  const ROW = 17;
  const ROW_NOTE = 22;
  const word = measure === 'dry' ? 'dry' : 'wet';
  const known = g => g.rate !== null && g.rate !== undefined;
  const height = groups.reduce((h, g) => h + (known(g) ? ROW : ROW_NOTE), 0);
  let top = 0;
  let body = '';

  for (const g of groups) {
    const count = measure === 'dry' ? (g.dry ?? g.count) : (g.wet ?? g.count);
    const nights = `${count ?? 0} of ${g.eligible ?? 0} nights`;
    body += text(0, top + LABEL, 'c-label', 'start', LABEL, g.label ?? '');
    // The track is drawn at full opacity behind every arm, including one
    // under the threshold: dimming the whole chart makes an honest limitation
    // look like a rendering failure.
    body += `<rect class="c-axis" x="0" y="${num(top + 5.2)}" width="${W}" height="4.2" `
      + 'rx="0.8" fill="currentColor" opacity="0.15"/>';
    body += text(0, top + 13.6, 'c-axis', 'start', LABEL, nights);
    if (known(g)) {
      body += `<rect class="c-${measure === 'dry' ? 'timing' : 'wet'}" x="0" `
        + `y="${num(top + 5.2)}" width="${num(Math.max(0, Math.min(1, g.rate)) * W)}" `
        + 'height="4.2" rx="0.8" fill="currentColor"/>';
      body += text(W, top + LABEL, 'c-label', 'end', LABEL, `${pct(g.rate)} ${word}`);
    } else {
      body += text(0, top + 13.6 + LABEL + 1.2, 'c-axis', 'start', LABEL, INSUFFICIENT);
    }
    top += known(g) ? ROW : ROW_NOTE;
  }

  const aria = label ?? `Comparison. ${groups.map(g => `${g.label ?? ''}: `
    + `${(measure === 'dry' ? (g.dry ?? g.count) : (g.wet ?? g.count)) ?? 0} of ${g.eligible ?? 0} nights`
    + (g.rate === null || g.rate === undefined ? ', not enough recorded nights' : `, ${pct(g.rate)} ${word}`)).join('. ')}.`;
  return svg(height, aria, body);
}

/* ── Text equivalent ────────────────────────────────────────────────────
   The same numbers as a plain sentence, for screen readers and for any
   context that does not draw the SVG. Dispatches on the `kind` every
   metrics.js result carries. Never states a cause. */

const NOT_CAUSAL = 'Observed alongside these records, not proof of cause.';

const METRIC_TITLE = {
  drinks: 'Evening drinks',
  lastToilet: 'Last toilet before sleep',
  lift: 'Parent lifts',
  bowel: 'The previous day’s bowel pattern',
};

const REASON = {
  reviewDue: 'not reviewed',
  unreviewed: 'not reviewed',
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

const nights = n => `${n} night${n === 1 ? '' : 's'}`;

// "2 for no asleep time and 1 for times out of order" — only the reasons that
// actually excluded something, so the sentence never lists a row of zeros.
function excludedText(excluded) {
  const parts = Object.entries(excluded ?? {})
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} for ${REASON[reason] ?? reason}`);
  if (!parts.length) return '';
  const list = parts.length === 1 ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return ` Excluded: ${list}.`;
}

function windowText(w, name) {
  const range = w.fromId && w.toId ? ` (${w.fromId} to ${w.toId})` : '';
  return `${name}${range}: ${w.wet} wet of ${nights(w.reviewed)} reviewed`
    + `${w.rate === null ? '' : ` (${pct(w.rate)})`}.`;
}

export function textEquivalent(result) {
  const r = result ?? {};
  switch (r.kind) {
    case 'coverage':
      return `${r.reviewed} of ${nights(r.total)} reviewed.`
        + (r.unreviewed ? ` ${r.unreviewed} not reviewed, of which ${r.wetRecordedReviewDue} `
          + `${r.wetRecordedReviewDue === 1 ? 'has' : 'have'} a wet event recorded.` : '');

    case 'wetNights':
      return (r.insufficient
        ? `${r.wet} wet of ${nights(r.reviewed)} reviewed. ${INSUFFICIENT}.`
        : `${r.wet} wet of ${nights(r.reviewed)} reviewed (${pct(r.rate)}), `
          + `equivalent to ${num(r.ratePerWeek)} wet nights per week.`)
        // Review-due nights are a subset of the unreviewed ones, so they are
        // named inside that clause rather than counted again beside it.
        + (r.unreviewed
          ? ` ${r.unreviewed} ${r.unreviewed === 1 ? 'night is' : 'nights are'} not reviewed and excluded`
            + `${r.excludedReviewDue ? `, including ${r.excludedReviewDue} with a wet event recorded` : ''}.`
          : '');

    case 'wetNightsByWeek':
      return `Wet nights by week: ${r.weeks.map(w => `${w.fromId} ${w.wet} of ${w.reviewed} reviewed`).join('; ')}.`;

    case 'firstWetting':
      return (r.points.length
        ? `First wetting after falling asleep: median ${num(r.median)} hours across ${nights(r.points.length)}.`
        : 'No nights have both an asleep time and a wet event yet.')
        + (r.insufficient && r.points.length ? ` ${INSUFFICIENT}.` : '')
        + excludedText(r.excluded);

    case 'wettingsPerWetNight':
      return (r.nights
        ? `${r.events} wettings across ${nights(r.nights)} with event detail, `
          + `${num(r.mean)} per wet night.`
        : 'No wet nights with event detail yet.')
        + excludedText(r.excluded);

    case 'noticed':
      return (r.insufficient
        ? `${r.self} of ${r.known} wet events with an answer recorded were noticed by her. ${INSUFFICIENT}.`
        : `${r.self} of ${r.known} wet events with an answer recorded were noticed by her (${pct(r.share)}).`)
        + (r.unknown ? ` ${r.unknown} events have no answer recorded.` : '');

    case 'askedToPee':
      return r.insufficient
        ? `She asked to pee on ${r.nights} of ${nights(r.reviewed)} reviewed. ${INSUFFICIENT}.`
        : `She asked to pee on ${r.nights} of ${nights(r.reviewed)} reviewed (${pct(r.share)}).`;

    case 'comparison': {
      const word = r.measure === 'dry' ? 'dry' : 'wet';
      const lines = r.groups.map(g => `${g.label}: ${g[word]} ${word} of ${nights(g.eligible)}`
        + (g.rate === null ? ', not enough recorded nights' : ` (${pct(g.rate)})`));
      return `${METRIC_TITLE[r.metric] ?? 'Comparison'}. ${lines.join('. ')}.`
        + excludedText(r.excluded)
        + (r.insufficient ? ` ${INSUFFICIENT}.` : ` ${NOT_CAUSAL}`);
    }

    case 'routineComparison':
      return r.windowNights
        ? `Two equal windows of ${nights(r.windowNights)}. ${windowText(r.before, 'Before')} `
          + `${windowText(r.during, 'During')}`
          + (r.insufficient ? ` ${INSUFFICIENT}.` : '')
          + ' Observed alongside this routine, not proof of cause.'
        : 'This routine has no completed nights yet.';

    default:
      return '';
  }
}
