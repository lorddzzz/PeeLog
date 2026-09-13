// The document schema and every pure helper over it: night identity, ISO
// timestamps, event shapes, migration and validation. No DOM, no storage —
// all of this is exercised headlessly and from the Check tab.

export const DOC_VERSION = 1;

// The document is JSON by definition — it is written to localStorage as a
// string — so this is the copy everything uses. structuredClone would tie the
// boot path to Safari 15.4 for nothing.
export const clone = x => JSON.parse(JSON.stringify(x));

/* ── Time ───────────────────────────────────────────────────────────────
   Every stored instant carries the offset it was recorded at. A bare local
   time silently corrupts "hours after falling asleep" across a DST change or
   a trip. A night id is the one exception: it labels a night, it is not an
   instant, so it stays a plain local date. */

// Evenings start at 15:00; anything before that belongs to the night before.
const NIGHT_START_HOUR = 15;

// A numeric offset only: 'Z' parses as an instant but its wall clock is UTC's,
// not the one the tap happened in, so reading it literally moves both the time
// shown and the night it belongs to. migrate rewrites any stored Z instead.
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?([+-]\d{2}:\d{2})$/;
const Z_ISO_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)Z$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n, w = 2) => String(n).padStart(w, '0');
const isoDate = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export function toIso(date) {
  const off = -date.getTimezoneOffset();
  const abs = Math.abs(off);
  return `${isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${off < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Reads the wall clock as it was written, from the string. Reinterpreting the
// instant in the device's current zone is what loses the travel case.
export function parseIso(iso) {
  const m = typeof iso === 'string' ? ISO_RE.exec(iso) : null;
  if (!m) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, ms };
}

export const isIso = value => parseIso(value) !== null;

export function isDateStr(value) {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const u = new Date(Date.UTC(y, mo - 1, d));
  return u.getUTCFullYear() === y && u.getUTCMonth() === mo - 1 && u.getUTCDate() === d;
}

// Local wall-clock parts → an instant stamped with this device's offset, or
// null if that wall clock does not exist. Date rolls both out-of-range parts
// ('99:99' lands four days later) and the hour a spring-forward skips (02:30
// becomes 03:30) silently forward, which would record a time nobody typed —
// so the result has to read back as exactly what was asked for.
export function composeIso(dateStr, timeStr) {
  const d = typeof dateStr === 'string' ? DATE_RE.exec(dateStr) : null;
  const t = typeof timeStr === 'string' ? /^(\d{2}):(\d{2})$/.exec(timeStr) : null;
  if (!d || !t || +t[1] > 23 || +t[2] > 59) return null;
  const iso = toIso(new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], 0, 0));
  const p = parseIso(iso);
  return p && p.date === dateStr && p.time === timeStr ? iso : null;
}

// Date arithmetic runs in UTC: a local midnight can be skipped entirely by a
// DST jump, which would move the label by a day.
export function shiftDate(dateStr, days) {
  const m = typeof dateStr === 'string' ? DATE_RE.exec(dateStr) : null;
  if (!m) return null;
  const u = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  u.setUTCDate(u.getUTCDate() + days);
  return isoDate(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
}

export function nightIdFor(date) {
  const id = isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return date.getHours() >= NIGHT_START_HOUR ? id : shiftDate(id, -1);
}

// The night an existing timestamp belongs to, read from the wall clock it was
// recorded at. Going through a Date would reinterpret it in the device's
// current zone, which is exactly the travel case we store offsets to survive.
export function nightIdForIso(iso) {
  const p = parseIso(iso);
  if (!p) return null;
  return +p.time.slice(0, 2) >= NIGHT_START_HOUR ? p.date : shiftDate(p.date, -1);
}

// The inverse, for a time typed into a field on a known night: 02:12 on the
// night of the 13th is the calendar date of the 14th.
export function dateForNightTime(nightId, timeStr) {
  const t = typeof timeStr === 'string' ? /^(\d{2}):(\d{2})$/.exec(timeStr) : null;
  if (!t || !isDateStr(nightId) || +t[1] > 23 || +t[2] > 59) return null;
  return +t[1] >= NIGHT_START_HOUR ? nightId : shiftDate(nightId, 1);
}

export const prevNightId = id => shiftDate(id, -1);

// night.day describes the day AFTER the night — the bowel overlay compares
// night N against night N−1's day, and it is easy to get backwards.
export const dayDateFor = nightId => shiftDate(nightId, 1);

/* ── Labels ─────────────────────────────────────────────────────────────
   Built from fixed names rather than toLocaleDateString: the copy is British
   ("13 September", not "September 13") and must not follow the device locale. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function dateParts(dateStr) {
  const m = typeof dateStr === 'string' ? DATE_RE.exec(dateStr) : null;
  if (!m) return null;
  const u = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], wd: u.getUTCDay() };
}

// 'Sun, 13 September'
export function dayLabelFor(dateStr) {
  const p = dateParts(dateStr);
  return p ? `${WEEKDAYS[p.wd]}, ${p.d} ${MONTHS[p.mo]}` : '';
}

// 'Sunday' — the stale-night link names the weekday in full.
export function weekdayNameFor(dateStr) {
  const p = dateParts(dateStr);
  return p ? WEEKDAY_NAMES[p.wd] : '';
}

// 'Night of Sun, 13 September'
export const nightLabelFor = nightId => {
  const label = dayLabelFor(nightId);
  return label ? `Night of ${label}` : '';
};

// 'Mon, 14 Sep · 02:12'
export function stampLabelFor(iso) {
  const p = parseIso(iso);
  const q = p && dateParts(p.date);
  return q ? `${WEEKDAYS[q.wd]}, ${q.d} ${MONTHS[q.mo].slice(0, 3)} · ${p.time}` : '';
}

// '02:12'
export function timeLabelFor(iso) {
  const p = parseIso(iso);
  return p ? p.time : '';
}

// 'peelog-2026-09-13.peelog.json' — the .peelog.json suffix is what
// AGENTS.md's gitignore already matches, so an export sitting in the repo
// directory can never be committed by accident.
export function exportFileName(date) {
  return `peelog-${isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate())}.peelog.json`;
}

/* ── Field tables ───────────────────────────────────────────────────────
   Option wording comes from UX-HANDOFF §E01–E05, R01–R03. `short` is only
   set where the chip label would read wrong inside a one-line summary. */

const OUTPUT = [
  { value: 'none', label: 'None' },
  { value: 'some', label: 'Some' },
  { value: 'lots', label: 'Lots' },
];

const yesNo = (yes, no) => [
  { value: true, label: 'Yes', short: yes },
  { value: false, label: 'No', short: no },
];

export const EVENT_TYPES = {
  selfToilet: {
    label: 'She asked to pee',
    icon: 'toilet',
    fields: [
      { key: 'output', label: 'Amount', kind: 'single', options: OUTPUT },
      {
        key: 'madeIt', label: 'Made it to the toilet', kind: 'single',
        options: yesNo('made it', 'did not make it'),
      },
    ],
  },
  lift: {
    label: 'I lifted her',
    icon: 'carry',
    fields: [
      { key: 'output', label: 'Amount', kind: 'single', options: OUTPUT },
      {
        key: 'woke', label: 'Woke during the lift', kind: 'single',
        options: yesNo('woke', 'slept through'),
      },
    ],
  },
  drink: {
    label: 'Water',
    icon: 'water',
    fields: [
      {
        key: 'size', label: 'Amount', kind: 'single',
        options: [{ value: 'sip', label: 'A sip' }, { value: 'cup', label: 'A cup' }],
      },
    ],
  },
  wake: {
    label: 'Woke up',
    icon: 'wake',
    fields: [
      {
        key: 'note', label: 'Note', kind: 'text',
        placeholder: 'Anything you want to remember?',
      },
    ],
  },
  wet: {
    label: 'Wet bed',
    icon: 'drop',
    fields: [
      {
        key: 'amount', label: 'Amount', kind: 'single',
        options: [
          { value: 'damp', label: 'Damp' },
          { value: 'wet', label: 'Wet' },
          { value: 'soaked', label: 'Soaked' },
        ],
      },
      {
        key: 'noticed', label: 'Who noticed', kind: 'single',
        options: [
          // `short` because the chip is addressed to the parent ("I found
          // it") and a summary is not — "i found it" mid-sentence reads as a
          // typo in a history row.
          { value: 'self', label: 'She woke', short: 'she woke' },
          { value: 'parent', label: 'I found it', short: 'parent noticed' },
        ],
      },
      {
        key: 'changed', label: 'Changed', kind: 'multi',
        options: [
          { value: 'sheets', label: 'Sheets' },
          { value: 'pyjamas', label: 'Pyjamas' },
        ],
      },
    ],
  },
};

// The action grid's order. Object key order would carry it, but nothing in the
// UI should depend on that.
export const EVENT_ORDER = ['selfToilet', 'lift', 'drink', 'wake', 'wet'];

export const EVENING_FIELDS = {
  // Stored on the night, not inside evening — the evening card edits it.
  diaper: {
    key: 'diaper', label: 'What she wore', kind: 'single',
    options: [
      { value: 'none', label: 'None' },
      { value: 'pull-up', label: 'Pull-up' },
      { value: 'diaper', label: 'Diaper' },
    ],
  },
  drinkSize: {
    key: 'size', label: 'Amount', kind: 'single',
    options: [
      { value: 'sip', label: 'Sip' },
      { value: 'cup', label: 'Cup' },
      { value: 'lots', label: 'Lots' },
    ],
  },
  lastToiletOutput: { key: 'lastToiletOutput', label: 'Last toilet', kind: 'single', options: OUTPUT },
  dayContext: {
    key: 'dayContext', label: 'Day context', kind: 'multi',
    options: [
      { value: 'nap', label: 'Nap' },
      { value: 'excited', label: 'Excited' },
      { value: 'unwell', label: 'Unwell' },
      { value: 'away', label: 'Away' },
      { value: 'new-place', label: 'New place' },
      { value: 'late-nap', label: 'Late nap' },
    ],
  },
};

export const MORNING_FIELDS = {
  outcome: {
    key: 'outcome', label: 'Outcome', kind: 'single',
    options: [
      { value: 'dry', label: 'Dry night' },
      { value: 'wet', label: 'Wet night' },
    ],
  },
  changes: { key: 'changes', label: 'Full changes', kind: 'count', min: 0 },
  mood: {
    key: 'mood', label: 'Mood', kind: 'single',
    options: [
      { value: 'upset', label: 'Upset' },
      { value: 'ok', label: 'OK' },
      { value: 'happy', label: 'Happy' },
    ],
  },
  sleepSigns: {
    key: 'sleepSigns', label: 'Sleep signs', kind: 'multi', exclusive: 'none',
    options: [
      { value: 'snoring', label: 'Snoring' },
      { value: 'mouth-breathing', label: 'Mouth breathing' },
      { value: 'restless', label: 'Restless' },
      { value: 'none', label: 'None' },
    ],
  },
};

export const DAY_FIELDS = {
  toiletCount: { key: 'toiletCount', label: 'Toilet visits', kind: 'count', min: 0 },
  urgency: { key: 'urgency', label: 'Urgency', kind: 'single', options: yesNo() },
  holding: {
    key: 'holding', label: 'Holding', kind: 'single', options: yesNo(),
    hint: 'Crossing legs or squatting to hold pee',
  },
  accidents: { key: 'accidents', label: 'Daytime accidents', kind: 'count', min: 0 },
  stool: {
    key: 'stool', label: 'Stool', kind: 'single',
    options: [
      { value: 'none', label: 'None' },
      { value: 'hard', label: 'Hard' },
      { value: 'normal', label: 'Normal' },
      { value: 'loose', label: 'Loose' },
    ],
  },
  fluids: {
    key: 'fluids', label: 'Fluids', kind: 'single',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'normal', label: 'Normal' },
      { value: 'high', label: 'High' },
    ],
  },
};

/* ── Constructors ───────────────────────────────────────────────────────
   null means nobody answered; false, 0 and 'none' mean someone did. Every
   metric denominator in DESIGN.md §5 depends on telling those apart. */

const rid = prefix => prefix + Math.random().toString(36).slice(2, 8).padEnd(6, '0');

const fieldDefault = f => (f.kind === 'multi' ? [] : f.kind === 'text' ? '' : null);

export function emptyDoc() {
  return {
    version: DOC_VERSION,
    activeNightId: null,
    nights: [],
    experiments: [],
    // `welcomed` is the one-time W01 flag: migrate's fillDefaults adds it to a
    // document written before M5, so an existing log never sees Welcome.
    settings: {
      lastBackupAt: null, lastBackupConfirmedAt: null, art: true, welcomed: false,
    },
  };
}

export function newNight(id) {
  return {
    id,
    diaper: null,
    experimentId: null,
    evening: {
      dinnerAt: null,
      drinks: [],
      noDrinks: null,
      lastToiletAt: null,
      lastToiletOutput: null,
      lightsOutAt: null,
      asleepAt: null,
      asleepEstimated: false,
      dayContext: [],
      note: '',
    },
    events: [],
    morning: {
      outcome: null,
      wakeAt: null,
      changes: null,
      mood: null,
      sleepSigns: null,
      eventsComplete: null,
      note: '',
    },
    day: {
      toiletCount: null,
      urgency: null,
      holding: null,
      accidents: null,
      stool: null,
      fluids: null,
    },
  };
}

export function newEvent(type, tIso) {
  const ev = { id: rid('e-'), t: tIso, type };
  for (const f of EVENT_TYPES[type]?.fields ?? []) ev[f.key] = fieldDefault(f);
  return ev;
}

export function newDrink(at = null, size = null) {
  return { id: rid('d-'), at, size };
}

/* ── Stepper ────────────────────────────────────────────────────────────
   Shared by ui.js's stepper control and the self-test: the first tap on
   either button answers `min`, so a count of zero is reachable without
   passing through one, and a value never drops below `min`. */
export function stepValue(value, min, delta) {
  return value === null || value === undefined ? min : Math.max(min, value + delta);
}

/* ── Evening drinks ─────────────────────────────────────────────────────
   noDrinks and a logged drink are facts that cannot both be true: adding a
   drink means evening drinks happened, so a stale "confirmed none" beside it
   would contradict the record. Confirming none, in turn, clears any rows
   that were only half-filled placeholders. */
export function addDrink(evening, drink) {
  evening.drinks.push(drink);
  evening.noDrinks = null;
}

export function setNoDrinks(evening, value) {
  evening.noDrinks = value ? true : null;
  if (value) evening.drinks = [];
}

export function findDrink(evening, id) {
  return evening.drinks.find(d => d.id === id) ?? null;
}

export function removeDrink(evening, id) {
  const at = evening.drinks.findIndex(d => d.id === id);
  return at === -1 ? null : evening.drinks.splice(at, 1)[0];
}

/* ── Sleep signs ────────────────────────────────────────────────────────
   'none' excludes every other sign and vice versa; removing the last sign
   returns to unknown rather than an empty array, which the schema does not
   treat as an answer (morning.sleepSigns is null | ['none'] | [...]). */
export function toggleSleepSign(signs, value) {
  const current = Array.isArray(signs) ? signs : [];
  if (value === 'none') return current.includes('none') ? null : ['none'];
  const rest = current.filter(v => v !== 'none' && v !== value);
  const next = current.includes(value) ? rest : [...rest, value];
  return next.length ? next : null;
}

/* ── Summaries ──────────────────────────────────────────────────────── */

function fieldText(f, value) {
  if (f.kind === 'multi') {
    return value
      .map(v => (f.options.find(o => o.value === v)?.label ?? String(v)).toLowerCase())
      .join(', ');
  }
  if (f.kind === 'text') {
    const s = String(value).replace(/\s+/g, ' ').trim();
    return s.length > 24 ? `${s.slice(0, 23)}…` : s;
  }
  const o = f.options.find(x => x.value === value);
  return o ? (o.short ?? o.label.toLowerCase()) : String(value);
}

const answered = v => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));

// 'Wet bed · soaked' — the type plus the first detail that was actually
// answered, for strips and history rows.
export function eventSummary(ev) {
  const def = EVENT_TYPES[ev?.type];
  if (!def) return ev?.type ?? '';
  for (const f of def.fields) {
    if (answered(ev[f.key])) return `${def.label} · ${fieldText(f, ev[f.key])}`;
  }
  return def.label;
}

// 'wet · parent noticed · sheets, pyjamas' — every answered detail, for a
// night's event rows. Empty when nothing was answered; the caller decides
// what unknown should read as.
export function eventDetailSummary(ev) {
  const def = EVENT_TYPES[ev?.type];
  if (!def) return '';
  return def.fields
    .filter(f => answered(ev[f.key]))
    .map(f => fieldText(f, ev[f.key]))
    .join(' · ');
}

// 'Asleep 20:45 · 1 drink' — Tonight's compact stand-in for the Evening
// details link before there is anything to summarise.
export function eveningSummaryFor(evening) {
  if (!evening) return null;
  const parts = [];
  if (evening.asleepAt) parts.push(`Asleep ${timeLabelFor(evening.asleepAt)}`);
  if (evening.noDrinks) parts.push('No drinks');
  else if (evening.drinks.length) parts.push(`${evening.drinks.length} drink${evening.drinks.length > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' · ') : null;
}

// Whether the following-day card has never been touched — Tonight only
// offers to add it while that is still true (a filled-in day should be
// corrected from history, not re-offered as if it were new).
export function dayIsUnanswered(day) {
  return !day || Object.values(day).every(v => v === null);
}

/* ── Night and event helpers ────────────────────────────────────────── */

const eventMs = ev => parseIso(ev?.t)?.ms ?? 0;

export function findNight(doc, id) {
  return doc.nights.find(n => n.id === id) ?? null;
}

export function ensureNight(draft, id) {
  const found = findNight(draft, id);
  if (found) return found;
  const night = newNight(id);
  // A routine that is running on this evening owns it from the moment the
  // night comes into existence, so nothing has to remember to tag it later.
  night.experimentId = activeExperiment(draft, id)?.id ?? null;
  const at = draft.nights.findIndex(n => n.id > id);
  if (at === -1) draft.nights.push(night);
  else draft.nights.splice(at, 0, night);
  return night;
}

export function openNight(draft, id) {
  const night = ensureNight(draft, id);
  draft.activeNightId = id;
  return night;
}

export function insertEvent(night, ev) {
  const ms = eventMs(ev);
  let at = night.events.length;
  while (at > 0 && eventMs(night.events[at - 1]) > ms) at--;
  night.events.splice(at, 0, ev);
  return ev;
}

export function removeEvent(night, id) {
  const at = night.events.findIndex(e => e.id === id);
  return at === -1 ? null : night.events.splice(at, 1)[0];
}

export function latestEvent(night) {
  return night && night.events.length ? night.events[night.events.length - 1] : null;
}

export function findEvent(night, id) {
  return night ? night.events.find(e => e.id === id) ?? null : null;
}

export function nightForEvent(doc, eventId) {
  return doc.nights.find(n => n.events.some(e => e.id === eventId)) ?? null;
}

// A night nobody has answered anything on: no events, nothing worn, no
// routine, and every evening / morning / day field still at its constructed
// default. Moving the only event out of such a night leaves a record of a
// night that never happened, which then asks to be reviewed.
export function isUntouchedNight(night) {
  if (!night || night.events?.length) return false;
  if ((night.diaper ?? null) !== null || (night.experimentId ?? null) !== null) return false;
  const fresh = newNight(night.id);
  return ['evening', 'morning', 'day'].every(block => {
    const got = night[block] ?? {};
    return Object.entries(fresh[block]).every(([k, v]) =>
      got[k] === undefined || JSON.stringify(got[k]) === JSON.stringify(v));
  });
}

// morning.outcome !== null *is* reviewed — there is no separate flag to fall
// out of sync with it.
export const isReviewed = night => (night?.morning?.outcome ?? null) !== null;

// Whether setting `outcome` on this night would silently override a wet event
// already recorded. Only Dry can conflict; Wet never contradicts an event.
// Returns the first conflicting wet event (in time order) so the screen can
// link straight to it, or null when the outcome is safe to write.
export function outcomeConflict(night, outcome) {
  if (outcome !== 'dry' || !night) return null;
  return night.events.find(e => e.type === 'wet') ?? null;
}

// Which night tonight's taps belong to, plus the older night still waiting for
// a review. A stale active night must never absorb the new evening's events.
export function activeNightFor(doc, now = new Date()) {
  const current = nightIdFor(now);
  const active = doc.activeNightId;
  if (active === current) return { id: active, stale: null };
  // A night open in the future is a clock artefact — a device clock that ran
  // fast, or a flight west. Tonight's taps belong to tonight either way, and a
  // night that has not happened yet is never offered for review.
  const pending = active && active < current && !isReviewed(findNight(doc, active)) ? active : null;
  return { id: current, stale: pending };
}

// Opening tonight moves activeNightId on, so activeNightFor can no longer see
// yesterday. The review link must survive the first tap of the new evening, so
// it is asked for separately: the night before this one, if it was recorded and
// nobody has reviewed it. Only the night before — an old gap is History's job,
// not a nightly nag.
export function pendingReviewFor(doc, nightId) {
  const previous = prevNightId(nightId);
  const night = findNight(doc, previous);
  return night && !isReviewed(night) ? previous : null;
}

// The previous recorded night's dinner / lights-out / asleep times, remapped
// onto this night's own calendar date so accepting one lands on the right
// day rather than the night it was copied from. Pure — a displayed
// suggestion is not a recorded fact until a field's own "Use" tap commits it
// (UX-HANDOFF rule 6), so this only computes; it never writes.
export function suggestedEveningTimes(doc, nightId) {
  const prev = findNight(doc, prevNightId(nightId));
  const remap = iso => {
    const p = iso ? parseIso(iso) : null;
    if (!p) return null;
    const date = dateForNightTime(nightId, p.time);
    return date ? composeIso(date, p.time) : null;
  };
  return {
    dinnerAt: remap(prev?.evening?.dinnerAt ?? null),
    lightsOutAt: remap(prev?.evening?.lightsOutAt ?? null),
    asleepAt: remap(prev?.evening?.asleepAt ?? null),
  };
}

/* ── History (H01–H06) ──────────────────────────────────────────────────
   Everything the history list, the night detail and the event edit draft
   need over the document. Pure, so the awkward parts — the boundary move,
   the calendar gaps, a deleted night coming back — are asserted on the
   Check tab rather than by clicking. */

// The four states a row may be in. A wet event on an unreviewed night is
// "wet recorded, review due" — it is not a confirmed wet outcome, and the
// metrics denominators (UX-HANDOFF P01) depend on telling those apart.
export function nightStatus(night) {
  const outcome = night?.morning?.outcome ?? null;
  if (outcome === 'dry' || outcome === 'wet') return outcome;
  return (night?.events ?? []).some(e => e.type === 'wet') ? 'wet-review-due' : 'review-due';
}

// The first wet entry's instant, or null. Events are kept in `t` order, so
// the first one found is the earliest.
export function firstWetTime(night) {
  return (night?.events ?? []).find(e => e.type === 'wet')?.t ?? null;
}

// Every type counted, including the zeroes — a caller listing "1 lift" must
// not have to guess whether a missing key means none or means unknown.
export function eventCounts(night) {
  const counts = Object.fromEntries(EVENT_ORDER.map(type => [type, 0]));
  for (const ev of night?.events ?? []) {
    if (counts[ev.type] !== undefined) counts[ev.type]++;
  }
  return counts;
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;

export const monthOf = dateStr => (isDateStr(dateStr) ? dateStr.slice(0, 7) : null);

export function shiftMonth(month, delta) {
  const m = typeof month === 'string' ? MONTH_RE.exec(month) : null;
  if (!m) return null;
  const total = +m[1] * 12 + (+m[2] - 1) + delta;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

// 'September 2026'
export function monthLabelFor(month) {
  const m = typeof month === 'string' ? MONTH_RE.exec(month) : null;
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}` : '';
}

// One row per date in the month, newest first. A date with no record inside
// the month reads "No record", never Dry (S01) — but only up to the night
// before tonight: tonight's own night is still being lived, and a night that
// has not happened yet is not a gap.
export function monthNightsWithGaps(doc, month, today = new Date()) {
  const m = typeof month === 'string' ? MONTH_RE.exec(month) : null;
  if (!m || +m[2] < 1 || +m[2] > 12) return [];
  const [y, mo] = [+m[1], +m[2]];
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lastGap = prevNightId(nightIdFor(today));
  const rows = [];
  for (let d = days; d >= 1; d--) {
    const id = isoDate(y, mo, d);
    const night = findNight(doc, id);
    if (night) rows.push({ id, night, kind: 'night', status: nightStatus(night) });
    else if (id <= lastGap) rows.push({ id, night: null, kind: 'no-record', status: 'no-record' });
  }
  return rows;
}

// An edited timestamp moves the event, and may move it to another night.
// Shared by Tonight's detail panel and History's edit draft so one rule
// decides where a moved entry lands — and what happens to the night it left.
export function moveEventTo(draft, eventId, newT) {
  const from = nightForEvent(draft, eventId);
  if (!from) return null;
  const toId = nightIdForIso(newT) ?? from.id;
  const entry = removeEvent(from, eventId);
  entry.t = newT;
  insertEvent(toId === from.id ? from : ensureNight(draft, toId), entry);
  // A night that held nothing but this event is not a night that happened —
  // left behind, it would ask every evening to review a blank record.
  if (toId !== from.id && isUntouchedNight(from)) {
    draft.nights.splice(draft.nights.indexOf(from), 1);
    if (draft.activeNightId === from.id) draft.activeNightId = null;
  }
  return { fromId: from.id, toId };
}

// A corrected type keeps only what is still true of the entry: when it
// happened, and which entry it is. No detail field survives — "amount" on a
// wet bed and "amount" on a drink are different questions that happen to
// share a name, so carrying one across would invent an answer.
export function retypeEvent(ev, newType) {
  const next = newEvent(newType, ev.t);
  next.id = ev.id;
  return next;
}

// Returns the removed night (with its index, so an Undo can put it back
// exactly where it was) or null when there was nothing to remove.
export function deleteNight(draft, id) {
  const index = draft.nights.findIndex(n => n.id === id);
  if (index === -1) return null;
  // Nothing may stay open on a night that no longer exists — and an Undo has
  // to know it was open, or restoring it would quietly close it.
  const wasActive = draft.activeNightId === id;
  const [night] = draft.nights.splice(index, 1);
  if (wasActive) draft.activeNightId = null;
  return { night, index, wasActive };
}

// Puts a deleted night back, keeping ascending order. A night recorded again
// in the meantime is left alone: replacing it would drop whatever was logged
// into it after the delete.
export function restoreNight(draft, night, wasActive = false) {
  if (!night || findNight(draft, night.id)) return null;
  const copy = clone(night);
  const at = draft.nights.findIndex(n => n.id > copy.id);
  if (at === -1) draft.nights.push(copy);
  else draft.nights.splice(at, 0, copy);
  if (wasActive) draft.activeNightId = copy.id;
  return copy;
}

// Backfill (H05/H06): the evening date decides everything, so it is checked
// before anything is written. An existing date opens its record rather than
// creating a second one for the same night.
export function backfillTarget(doc, dateStr, now = new Date()) {
  if (!isDateStr(dateStr)) return { id: null, valid: false, exists: false, future: false };
  return {
    id: dateStr,
    valid: true,
    exists: !!findNight(doc, dateStr),
    // Tonight's own night is the latest evening that can be recorded.
    future: dateStr > nightIdFor(now),
  };
}

/* ── Routines (X01–X04) ─────────────────────────────────────────────────
   One routine runs at a time; a night belongs to whichever routine's dates
   cover its evening. Membership is stored on the night so that editing a
   routine's dates later cannot silently re-label nights that were already
   compared — only an explicit date edit does that, through assignExperiment. */

export function newExperiment(name, from, note = '') {
  return { id: rid('exp-'), name: String(name ?? '').trim(), from, to: null, note };
}

// The routine covering one evening, or null. Night creation asks this, so a
// night logged tonight carries the routine without anyone tagging it.
export function activeExperiment(doc, nightId) {
  if (!isDateStr(nightId)) return null;
  let best = null;
  for (const e of Array.isArray(doc?.experiments) ? doc.experiments : []) {
    if (!e || !isDateStr(e.from) || nightId < e.from) continue;
    if (e.to && nightId > e.to) continue;
    // Overlapping routines are not supposed to exist; if a restored file
    // produced a pair, the later start is the one in force.
    if (!best || e.from > best.from) best = e;
  }
  return best;
}

// The routine that is still running — what X01 shows as Current, and what
// X02 has to offer to end before a new one starts.
export function openExperiment(doc) {
  const open = (doc?.experiments ?? []).filter(e => e && !e.to);
  return open.length ? open.reduce((a, b) => (b.from > a.from ? b : a)) : null;
}

// Tags the nights inside a routine's window. Nights before `from` are never
// rewritten (X02): a routine that started on the 1st says nothing about the
// 31st, and back-dating one would rewrite the Before window it is compared to.
export function assignExperiment(draft, exp) {
  if (!exp || !isDateStr(exp.from)) return 0;
  let tagged = 0;
  for (const night of draft.nights ?? []) {
    if (night.id < exp.from) continue;
    if (exp.to && night.id > exp.to) continue;
    night.experimentId = exp.id;
    tagged++;
  }
  return tagged;
}

// `lastId` is the final evening the routine includes, and it is inclusive.
// The caller decides which evening that is: an explicit End uses the last
// completed night, while starting a replacement ends this one the evening
// before the new one begins.
export function endExperiment(draft, id, lastId) {
  const exp = (draft.experiments ?? []).find(e => e.id === id);
  if (!exp || !isDateStr(lastId)) return null;
  exp.to = lastId;
  // "New nights will have no routine assigned" (X04) — including a night
  // already recorded past the end date.
  for (const night of draft.nights ?? []) {
    if (night.experimentId === id && night.id > lastId) night.experimentId = null;
  }
  return exp;
}

// A routine that never started (a scheduled one) has no comparison to keep,
// so it can go entirely rather than being ended before it began.
export function removeExperiment(draft, id) {
  const at = (draft.experiments ?? []).findIndex(e => e.id === id);
  if (at === -1) return null;
  const [exp] = draft.experiments.splice(at, 1);
  for (const night of draft.nights ?? []) {
    if (night.experimentId === id) night.experimentId = null;
  }
  return exp;
}

// Whole days elapsed since an instant — "Last backup: 11 days ago". Floored,
// so it never rounds a backup up to sounding fresher than it is.
export function daysSince(iso, now = new Date()) {
  const p = parseIso(iso);
  if (!p) return null;
  return Math.max(0, Math.floor((now.getTime() - p.ms) / 86400000));
}

/* ── CSV (O01) ──────────────────────────────────────────────────────────
   One row per night, flattened. RFC 4180: a field containing a comma, a
   quote or a line break is quoted and its quotes doubled. A blank field is
   a blank field — an unanswered question is never exported as No, 0 or Dry
   (UX-HANDOFF O01). */

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The event columns count *recorded* events, which is not the same claim as
// "this many things happened": a night nobody wrote events for reads 0 either
// way, so the header has to say which one it is (O01, missing-data rules).
export const CSV_COLUMNS = [
  'night', 'routine', 'wore',
  'dinner_at', 'evening_drinks', 'no_drinks', 'last_toilet_at', 'last_toilet_output',
  'lights_out_at', 'asleep_at', 'asleep_estimated', 'day_context', 'evening_note',
  'events_recorded', 'self_toilet_events_recorded', 'lift_events_recorded',
  'drink_events_recorded', 'wake_events_recorded', 'wet_events_recorded',
  'first_wet_at', 'hours_after_asleep',
  'outcome', 'wake_at', 'changes', 'mood', 'sleep_signs', 'events_complete',
  'morning_note',
  'day_date', 'day_toilet_count', 'day_urgency', 'day_holding', 'day_accidents',
  'day_stool', 'day_fluids',
];

function hoursAfterAsleep(night) {
  const asleep = parseIso(night?.evening?.asleepAt ?? null);
  const wet = parseIso(firstWetTime(night));
  if (!asleep || !wet || wet.ms <= asleep.ms) return null;
  return Math.round(((wet.ms - asleep.ms) / 3600000) * 100) / 100;
}

const list = value => (Array.isArray(value) && value.length ? value.join('; ') : null);

// An empty drinks array is only a zero once someone answered "none": before
// that it is an unrecorded evening, and exporting it as 0 would read as a
// confirmed no-drinks night (UX-HANDOFF O01).
function drinkCount(evening) {
  const drinks = evening?.drinks;
  if (Array.isArray(drinks) && drinks.length) return drinks.length;
  return evening?.noDrinks === true ? 0 : null;
}

// Raw values, not text: csvEscape turns them into fields, and the self-test
// can assert what a note actually round-trips as.
export function csvRows(doc, fromId, toId) {
  const rows = [CSV_COLUMNS.slice()];
  for (const night of doc?.nights ?? []) {
    if (fromId && night.id < fromId) continue;
    if (toId && night.id > toId) continue;
    const { evening = {}, morning = {}, day = {} } = night;
    const counts = eventCounts(night);
    const exp = (doc.experiments ?? []).find(e => e.id === night.experimentId) ?? null;
    rows.push([
      night.id, exp ? exp.name : null, night.diaper ?? null,
      evening.dinnerAt ?? null, drinkCount(evening), evening.noDrinks ?? null,
      evening.lastToiletAt ?? null, evening.lastToiletOutput ?? null,
      evening.lightsOutAt ?? null, evening.asleepAt ?? null,
      evening.asleepAt ? !!evening.asleepEstimated : null,
      list(evening.dayContext), evening.note || null,
      night.events?.length ?? 0, counts.selfToilet, counts.lift, counts.drink,
      counts.wake, counts.wet,
      firstWetTime(night), hoursAfterAsleep(night),
      morning.outcome ?? null, morning.wakeAt ?? null, morning.changes ?? null,
      morning.mood ?? null, list(morning.sleepSigns), morning.eventsComplete ?? null,
      morning.note || null,
      dayDateFor(night.id), day.toiletCount ?? null, day.urgency ?? null,
      day.holding ?? null, day.accidents ?? null, day.stool ?? null, day.fluids ?? null,
    ]);
  }
  return rows;
}

// CRLF line endings, as RFC 4180 specifies, and a trailing one so the last
// row is terminated like every other.
export function csvText(doc, fromId, toId) {
  return `${csvRows(doc, fromId, toId).map(r => r.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}

export function csvFileName(fromId, toId) {
  // .peelog.csv, like .peelog.json, is gitignored: an export saved into the
  // repo directory can never be committed by accident.
  return `peelog-nights-${fromId}_${toId}.peelog.csv`;
}

/* ── Migration ──────────────────────────────────────────────────────── */

// Fills keys that were added after a document was written. Only missing keys
// are touched: an answered false or 0 must survive untouched.
function fillDefaults(value, defaults) {
  const out = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in out)) out[k] = clone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = fillDefaults(out[k], v);
  }
  return out;
}

// An instant written as UTC by an older build (or by a hand-edited file) is
// the same fact, so it is rewritten rather than refused — every timestamp in
// the document, wherever it sits, since all of them are read as wall clocks.
function normaliseInstants(value) {
  if (typeof value === 'string') return value.replace(Z_ISO_RE, '$1+00:00');
  if (Array.isArray(value)) return value.map(normaliseInstants);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normaliseInstants(v)]));
  }
  return value;
}

export function migrate(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: true, doc: emptyDoc() };
  if (!Number.isInteger(doc.version) || doc.version < 1) return { ok: true, doc: emptyDoc() };
  // Restore has to refuse a document written by a later build with its own
  // message rather than silently dropping fields it does not understand.
  if (doc.version > DOC_VERSION) return { ok: false, reason: 'newer' };

  // Cloned first so the returned document shares nothing with the parsed input.
  const src = normaliseInstants(clone(doc));
  const out = fillDefaults(src, emptyDoc());
  out.version = DOC_VERSION;
  out.nights = (Array.isArray(src.nights) ? src.nights : []).map(n => {
    const night = fillDefaults(n, newNight(n?.id));
    night.events = (Array.isArray(night.events) ? night.events : [])
      .map(ev => fillDefaults(ev, newEvent(ev?.type, ev?.t)));
    return night;
  });
  out.experiments = Array.isArray(src.experiments) ? src.experiments : [];
  return { ok: true, doc: out };
}

/* ── Validation ─────────────────────────────────────────────────────────
   Used by restore: a file that fails here is refused whole, never imported
   in part. */

export function validateDoc(doc) {
  const errors = [];
  const add = msg => { if (errors.length < 50) errors.push(msg); };
  const checkIso = (v, at) => { if (v !== null && v !== undefined && !isIso(v)) add(`${at} is not ISO-8601 with an offset`); };

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['Not a PeeLog document'] };
  }
  if (!Number.isInteger(doc.version) || doc.version < 1) add('version is missing');
  else if (doc.version > DOC_VERSION) add(`version ${doc.version} is newer than this app understands`);
  // A missing activeNightId is "no night open", not corruption.
  if ((doc.activeNightId ?? null) !== null && !isDateStr(doc.activeNightId)) add('activeNightId is not a date');
  if (!doc.settings || typeof doc.settings !== 'object') add('settings is missing');
  if (!Array.isArray(doc.experiments)) add('experiments is not an array');

  if (!Array.isArray(doc.nights)) {
    add('nights is not an array');
    return { ok: false, errors };
  }

  let prevId = '';
  // Event ids address an event across the whole document (nightForEvent takes
  // no night), so a repeat would make one of them unreachable and edits land
  // on the other. Drink ids are only ever looked up inside their own evening.
  const seenEvents = new Set();
  doc.nights.forEach((night, i) => {
    const at = `nights[${i}]`;
    if (!night || typeof night !== 'object') { add(`${at} is not an object`); return; }
    if (!isDateStr(night.id)) add(`${at}.id is not a date`);
    else if (prevId && night.id <= prevId) add(`${at}.id ${night.id} is not after ${prevId}`);
    if (isDateStr(night.id)) prevId = night.id;

    const { evening, morning, day } = night;
    if (!evening || typeof evening !== 'object') add(`${at}.evening is missing`);
    else {
      for (const k of ['dinnerAt', 'lastToiletAt', 'lightsOutAt', 'asleepAt']) checkIso(evening[k], `${at}.evening.${k}`);
      if (!Array.isArray(evening.drinks)) add(`${at}.evening.drinks is not an array`);
      else {
        const seenDrinks = new Set();
        evening.drinks.forEach((d, j) => {
          checkIso(d?.at, `${at}.evening.drinks[${j}].at`);
          if (typeof d?.id !== 'string' || !d.id) return;
          if (seenDrinks.has(d.id)) add(`${at}.evening.drinks[${j}].id ${d.id} is not unique`);
          seenDrinks.add(d.id);
        });
      }
      if (!Array.isArray(evening.dayContext)) add(`${at}.evening.dayContext is not an array`);
    }
    if (!morning || typeof morning !== 'object') add(`${at}.morning is missing`);
    else {
      checkIso(morning.wakeAt, `${at}.morning.wakeAt`);
      if (morning.outcome !== null && !['dry', 'wet'].includes(morning.outcome)) add(`${at}.morning.outcome is not dry, wet or null`);
    }
    if (!day || typeof day !== 'object') add(`${at}.day is missing`);

    if (!Array.isArray(night.events)) { add(`${at}.events is not an array`); return; }
    let lastMs = -Infinity;
    night.events.forEach((ev, j) => {
      const where = `${at}.events[${j}]`;
      if (!ev || typeof ev !== 'object') { add(`${where} is not an object`); return; }
      if (typeof ev.id !== 'string' || !ev.id) add(`${where}.id is missing`);
      else if (seenEvents.has(ev.id)) add(`${where}.id ${ev.id} is not unique`);
      else seenEvents.add(ev.id);
      if (!EVENT_TYPES[ev.type]) add(`${where}.type ${JSON.stringify(ev.type)} is unknown`);
      const p = parseIso(ev.t);
      if (!p) { add(`${where}.t is not ISO-8601 with an offset`); return; }
      if (p.ms < lastMs) add(`${where}.t is out of order`);
      lastMs = p.ms;
    });
  });

  return { ok: errors.length === 0, errors };
}

/* ── Restore (B02–B07) ──────────────────────────────────────────────────
   Reading a backup and applying one are two separate steps, and neither
   touches the live document: `readBackup` turns text into a document or one
   specific message, `restorePlan` says what would change, and `applyRestore`
   returns a whole new document or an error. Nothing is ever applied in part
   (UX-HANDOFF B03). */

export const RESTORE_MESSAGES = {
  unreadable: 'This file isn’t a readable backup.',
  csv: 'This is a CSV file, not a JSON backup.',
  notBackup: 'This file isn’t a PeeLog backup.',
  newer: 'This backup needs a newer version of PeeLog.',
  empty: 'Nothing to read yet. Choose a file or paste the backup text.',
};

// A CSV picked by mistake is the likeliest wrong file — it is what O01 hands
// out — so it gets named rather than lumped in with unreadable JSON.
const looksLikeCsv = raw =>
  !raw.startsWith('{') && !raw.startsWith('[') && raw.split('\n', 1)[0].includes(',');

export function readBackup(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { ok: false, message: RESTORE_MESSAGES.empty };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Deliberately no excerpt of the text: a parse error must not put private
    // records on screen (UX-HANDOFF B02).
    return { ok: false, message: looksLikeCsv(raw) ? RESTORE_MESSAGES.csv : RESTORE_MESSAGES.unreadable };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.nights)) {
    return { ok: false, message: RESTORE_MESSAGES.notBackup };
  }

  const m = migrate(parsed);
  if (!m.ok) return { ok: false, message: RESTORE_MESSAGES.newer };
  if (!validateDoc(m.doc).ok) return { ok: false, message: RESTORE_MESSAGES.unreadable };
  return { ok: true, doc: m.doc };
}

const idsOf = list => new Set((list ?? []).map(x => x?.id));

// Every id the local document already owns. Event ids address an event across
// the whole document, so an incoming night carrying one of them cannot be
// added beside it — the commonest way that happens is a boundary move here
// that deleted the blank source night after the backup was taken.
function ownedIds(doc) {
  const events = new Set();
  const drinks = new Set();
  for (const night of doc?.nights ?? []) {
    for (const ev of night?.events ?? []) if (ev?.id) events.add(ev.id);
    for (const d of night?.evening?.drinks ?? []) if (d?.id) drinks.add(d.id);
  }
  return { events, drinks };
}

// What a restore would do, computed before anything changes. A `routine`
// conflict is structural and blocks the whole file; an id conflict only costs
// that one night, which add-missing skips and names in the preview.
export function restorePlan(local, incoming, mode = 'add') {
  const localNights = idsOf(local?.nights);
  const localExp = idsOf(local?.experiments);
  const incomingExp = idsOf(incoming?.experiments);
  const owned = ownedIds(local);
  const nights = incoming?.nights ?? [];
  const plan = {
    mode: mode === 'replace' ? 'replace' : 'add',
    nights: nights.length,
    routines: (incoming?.experiments ?? []).length,
    fromId: nights.length ? nights[0].id : null,
    toId: nights.length ? nights[nights.length - 1].id : null,
    localNights: local?.nights?.length ?? 0,
    added: 0,
    skipped: 0,
    collided: 0,
    collidedIds: [],
    replaced: 0,
    routinesAdded: 0,
    blocked: false,
    conflicts: [],
    routineIssues: [],
  };

  const replacing = plan.mode === 'replace';
  if (replacing) plan.replaced = plan.localNights;

  // A replace takes the file wholesale, so nothing it carries can collide
  // with ids that are about to be thrown away.
  const collisionIn = night => {
    if (replacing) return null;
    if ((night?.events ?? []).some(ev => ev?.id && owned.events.has(ev.id))) return 'event-id';
    if ((night?.evening?.drinks ?? []).some(d => d?.id && owned.drinks.has(d.id))) return 'drink-id';
    return null;
  };

  const wanted = new Set();
  for (const night of nights) {
    if (!replacing && localNights.has(night.id)) { plan.skipped++; continue; }

    const clash = collisionIn(night);
    if (clash) {
      plan.collided++;
      plan.collidedIds.push(night.id);
      plan.conflicts.push({
        id: night.id,
        reason: clash,
        text: `The night of ${dayLabelFor(night.id)} holds an entry that is already on this phone.`,
      });
      continue;
    }
    plan.added++;

    const ref = night.experimentId ?? null;
    if (!ref) continue;
    // A night pointing at a routine neither document holds is a damaged
    // reference: it would import a night labelled with a routine nobody can
    // open, so it blocks the restore (UX-HANDOFF B03).
    if (incomingExp.has(ref)) wanted.add(ref);
    else if (!replacing && localExp.has(ref)) { /* already on this phone */ }
    else {
      plan.conflicts.push({
        id: night.id,
        reason: 'routine',
        experimentId: ref,
        text: `The night of ${dayLabelFor(night.id)} names a routine that is missing from this backup.`,
      });
    }
  }

  // Only the routines the imported nights actually point at come across; a
  // routine nobody references would just add a second "current" one.
  plan.routineIds = [...wanted];
  for (const id of wanted) if (!localExp.has(id)) plan.routinesAdded++;

  if (!replacing) {
    const incomingOpen = (incoming?.experiments ?? []).filter(e => wanted.has(e.id) && !e.to);
    const localOpen = (local?.experiments ?? []).filter(e => !e.to);
    if (incomingOpen.length && localOpen.length) {
      plan.routineIssues.push('This backup brings a routine that is still running, '
        + 'and one is already running here. End one in Routines.');
    }
    const renamed = (incoming?.experiments ?? []).filter(e => {
      const mine = (local?.experiments ?? []).find(x => x.id === e.id);
      return mine && mine.name !== e.name;
    });
    for (const e of renamed) {
      plan.routineIssues.push(`“${e.name}” is already recorded here under a different name; `
        + 'the name on this phone is kept.');
    }
  }

  plan.blocked = plan.conflicts.some(c => c.reason === 'routine');
  return plan;
}

function insertNight(draft, night) {
  const at = draft.nights.findIndex(n => n.id > night.id);
  if (at === -1) draft.nights.push(night);
  else draft.nights.splice(at, 0, night);
}

// Returns the whole new document, or `{ error }` — never a half-applied one.
// Both inputs are left exactly as they were.
export function applyRestore(local, incoming, mode = 'add') {
  if (!validateDoc(incoming).ok) return { error: RESTORE_MESSAGES.unreadable };
  const plan = restorePlan(local, incoming, mode);
  // Structural only: a night whose ids are already here is left out, not a
  // reason to refuse the other nights in the file.
  const blocking = plan.conflicts.find(c => c.reason === 'routine');
  if (blocking) return { error: blocking.text };

  let next;
  if (plan.mode === 'replace') {
    next = clone(incoming);
    // Appearance and backup status describe this phone, not the log, so they
    // stay behind when the log is replaced.
    next.settings = clone(local?.settings ?? emptyDoc().settings);
  } else {
    next = clone(local);
    const have = idsOf(next.experiments);
    const referenced = new Set(plan.routineIds ?? []);
    for (const exp of incoming.experiments ?? []) {
      if (referenced.has(exp.id) && !have.has(exp.id)) {
        next.experiments.push(clone(exp));
        have.add(exp.id);
      }
    }
    const known = idsOf(next.nights);
    const collided = new Set(plan.collidedIds);
    for (const night of incoming.nights ?? []) {
      if (!known.has(night.id) && !collided.has(night.id)) insertNight(next, clone(night));
    }
  }

  // The merged document has to be as valid as the two it came from — a
  // duplicate event id across the join would make one of them unreachable.
  if (!validateDoc(next).ok) {
    return { error: 'These records cannot be added without changing existing ones.' };
  }
  return next;
}
