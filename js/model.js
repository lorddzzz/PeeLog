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
          { value: 'self', label: 'She woke' },
          { value: 'parent', label: 'I found it' },
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
    settings: { lastBackupAt: null, lastBackupConfirmedAt: null, art: true },
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
