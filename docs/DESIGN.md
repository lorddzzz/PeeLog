# PeeLog — Design & Scope v1

A night-wetting tracker for one child, built for the person logging at 3am.

**Design handoff:** the approved visual direction and complete basic UX are
documented in [UX-HANDOFF.md](UX-HANDOFF.md), with a [screen atlas](ux/index.html)
and [asset library](ux/ASSETS.md). That handoff supersedes this document's earlier
visual and interaction proposals — except where §4 below has since moved on
(17 September 2026: Tonight's three phases, the retired fields, and the
one-back-button navigation), which is now the rule.

**Build plan:** [IMPLEMENTATION.md](IMPLEMENTATION.md) — module map, milestone
pass/fail bars, and the record of how the two specs were reconciled. The
data-definition issues the handoff raised are resolved in §3 below, so this
file remains the source of truth for scope, schema, and technical background.

## 1. The problem, stated precisely

We need enough structured data about nights to make three decisions with confidence:

1. **Go back to diapers / pull-ups for now?** → needs a reliable wet-nights-per-week trend.
2. **Ask for medical advice?** → needs the specific things a pediatrician asks about.
3. **Change the routine?** → needs before/after comparison of one changed variable.

The binding constraint is not the data model. It is that most logging happens at 3am,
one-handed, in the dark, tired, possibly with a crying child. Any friction there produces
missing nights, and a log with holes answers none of the three questions.

**Core principle: the first tap saves the event.** Detail is always optional enrichment,
added after the fact or corrected in the morning. Nothing is ever gated behind a form.

## 2. Non-goals (v1)

- No accounts, login, or cloud sync.
- No multiple children.
- No photos, timers, or live activities.
- **No streaks or gamification.** This is a log about something a 4-year-old cannot control;
  a broken streak badge is the wrong emotional object to put in this app.
- No in-app alarms or push notifications (see §8).

## 3. Data model

One JSON document in `localStorage` under key `peelog:v1`. Total size after a year is
well under 500 KB. Every mutation writes the whole document — atomic, trivially exportable.

Two rules run through the whole schema:

- **Every stored instant is ISO-8601 with offset.** Never a bare local time. The
  hours-after-asleep metric is computed across a night, and a DST change or a trip
  silently corrupts it otherwise. A night `id` is the one exception: it is a plain
  local date because it is a label, not an instant.
- **`null` means nobody answered.** `false`, `0`, and `"none"` mean someone did.
  Every metric denominator in §5 depends on telling those apart, so an unset field
  is never stored as an empty or falsy value that reads as an observation.

```jsonc
{
  "version": 1,
  "activeNightId": "2026-09-13",   // null when no night is open
  "nights": [ /* Night, ascending by id */ ],
  "experiments": [ /* Experiment */ ],
  "settings": {
    "lastBackupAt": null,          // when a backup was prepared
    "lastBackupConfirmedAt": null, // when the parent confirmed it was saved
    "art": true                    // illustration toggle
  }
}
```

### Night

Keyed by the date of the **evening**. The night of Sep 13 → morning of Sep 14 is `"2026-09-13"`.

```jsonc
{
  "id": "2026-09-13",
  "experimentId": null,

  "evening": {
    "dinnerAt": null,                            // ISO-8601 with offset
    "drinks": [                                  // [] is unknown, not "no drinks"
      { "id": "d1", "at": "2026-09-13T19:10:00+02:00", "size": "cup" }  // sip | cup | lots
    ],
    "noDrinks": null,                // null unknown | true — confirmed none
    "lastToiletAt": null,
    "lastToiletOutput": null,        // null | none | some | lots
    "lightsOutAt": null,
    "asleepAt": null,                // never inferred from lightsOutAt
    "asleepEstimated": false,
    "dayContext": [],                // nap | excited | unwell | away | new-place | late-nap
    "note": ""
  },

  "events": [ /* Event, sorted by t */ ],

  "morning": {
    "outcome": null,                 // null review due | dry | wet — confirmed, never derived
    "wakeAt": null,
    "mood": null,                    // upset | ok | happy
    "sleepSigns": null,              // null unknown | ["none"] exclusive | snoring | mouth-breathing | restless
    "eventsComplete": null,          // null | true — the night's events are known to be complete
    "note": ""
  },

  "day": {                           // the day AFTER this night; optional
    "accidents": null,               // daytime wetting, a count; 0 is an answer
    "stool": null                    // null no record | none | hard | normal | loose
  }
}
```

**Retired fields (17 September 2026).** `diaper`, `morning.changes`,
`day.toiletCount`, `day.urgency`, `day.holding` and `day.fluids` are no longer
asked anywhere: the parent is not with her through the day, what she wore was
always nothing, and a morning count of full changes duplicated what the wet
entries already say. A document that holds them is still valid — `migrate`
keeps unknown keys, nothing reads them, restore carries them through — so no
version bump was needed. The CSV exports `changes_recorded` instead: wet
entries where sheets or pyjamas were changed.

`morning.outcome !== null` *is* the definition of a reviewed night — there is no
separate reviewed flag that could fall out of sync with it.

`noDrinks` and `eventsComplete` exist because several §5 comparisons need a night
to be positively eligible. An empty `drinks` array cannot be read as "she drank
nothing"; a night with no `wet` events cannot be read as "zero wettings" unless
someone confirmed the event record is complete.

`day` describes the day **after** this night. The bowel overlay therefore compares
night N's outcome against night **N−1**'s `day.stool`.

### Event

```jsonc
{ "id": "e-k3f9x2", "t": "2026-09-14T02:12:00+02:00", "type": "wet",
  "amount": null, "noticed": null, "changed": [] }
```

Type-specific fields start `null` (or `[]` where multi-select), and tapping an
already-selected chip clears it back to `null` — a mistaken tap must be able to
get back to unknown.

| type | meaning | optional detail |
|---|---|---|
| `wet` | bed is wet | `amount`: damp \| wet \| soaked · `noticed`: self \| parent · `changed`: [sheets, pyjamas] |
| `selfToilet` | **she woke and asked / went to pee** | `output`: none \| some \| lots · `madeIt`: true \| false |
| `lift` | I carried her to the potty | `output`: none \| some \| lots · `woke`: true \| false |
| `drink` | she asked for water | `size`: sip \| cup |
| `wake` | woke / cried, not pee-related | `note` |

`selfToilet` is the single most important event type. It is the behaviour we are trying to
grow, and a night with a `selfToilet` and no `wet` is a qualitatively different success from
a night that was simply dry. A `selfToilet` with `madeIt: false` never manufactures a `wet`
event — those are two separate observations, and only one of them was witnessed.

### Night boundary

An explicit `activeNightId` is opened by the evening card (or by the first night event) and
closed by the morning review. On a cold start with no active night, fall back to: events
between 15:00 and 14:59 the next day belong to the night dated at the earlier 15:00.

A **stale** `activeNightId` — one older than the night the clock is now in — must not absorb
the new evening's events. Tonight moves to the new night and carries a compact link back to
the unreviewed one.

Timestamps are stored as full ISO-8601 **with offset**, so daylight-saving changes and travel
don't silently corrupt the "hours after falling asleep" metric.

### Experiment

```jsonc
{ "id": "exp-1", "name": "No drinks after 18:30", "from": "2026-09-14", "to": null, "note": "" }
```

## 4. Screens

Three. No navigation drawer, no settings maze. A tab bar of three items.

### 4.1 Tonight — the home screen, and the only one that matters at 3am

Opens directly to the active night. Near-black `#10151E` ground, dim desaturated accents,
large type. **One grid, three phases**, and everything on it follows the same rule as a
night event: the first tap saves, detail is optional enrichment below.

| Phase | Read off the record as | Grid |
|---|---|---|
| Evening | no `asleepAt` | Dinner · Drink · Last toilet · Lights out, then **Fell asleep** (wide) |
| Night | `asleepAt` set, no `wakeAt` | the five night actions below, then **She's up** (wide) |
| Day | `wakeAt` set | **Dry night / Wet night**, She's up (time + mood, sleep signs, note), Stool chips, Daytime accidents stepper |

Each step stamps *now* into the field the cards used to ask for (`evening.dinnerAt`,
`morning.wakeAt`, a row in `evening.drinks` …), so the stored record did not change
shape. A step already stamped opens its panel to edit the time rather than stamping
again; Last toilet is the exception and re-stamps, because it is the *last* one. The
phase is derived, never stored, so the screen cannot disagree with the data. Where the
record says nothing the clock fills in: 23:30–10:00 reads as night, 10:00 to the 15:00
boundary as day. An Evening · Night · Day pill switches the view for a visit — a night
event at 21:00 before anyone tapped Fell asleep, or last night's review at 16:00 — and
the step that would have brought the screen into the current phase is offered again,
compact, while its stamp is missing. Stool and accidents also sit under the evening
grid, labelled as today, so a 17:00 stool lands on last night's day.

Undo reverses the last tap whatever it wrote — an event, a drink row, a stamp, an
outcome, a stool answer — through one rule in `model.js`. With nothing tapped this
visit it falls back to removing the night's latest event, as before.

The night grid is unchanged (thumb zone, 2×3):

```
┌─────────────────┬─────────────────┐
│  ⌾ She asked    │   ⌾ I lifted    │
│    to pee       │     her         │
├─────────────────┼─────────────────┤
│  ⌾ Water        │  ⌾ Woke up      │
├─────────────────┴─────────────────┤
│  ⌾ Wet bed                        │   ← widest, lowest, hardest to miss
├───────────────────────────────────┤
│  02:12 wet · soaked      ↩ undo   │   ← last event strip
└───────────────────────────────────┘
```

`⌾` is a line icon from the asset set, always paired with its text label. No emoji.

Interaction on any button:

1. Tap → event committed at `now`, saved. **Done. You can put the phone down.**
   Confirmation is visual: Safari on iOS exposes no Vibration API, so a haptic buzz
   would silently do nothing on the target device.
2. A detail row of chips slides up (e.g. `damp | wet | soaked`, then `woke herself | I found it`).
3. Chips are one tap each, no confirm. There is **no auto-dismiss timer** — a panel that
   vanishes while someone is reading it is worse than one that waits. Detail stays until
   Done, another event, or navigation.
4. The last-event strip always offers a single `↩ undo`.

Above the grid, a compact summary of the night so far (asleep 20:45 · 1 lift · 1 wet).

No white flashes, no animations that draw attention, no sounds.

Keeping the screen awake is **not buildable on the target device**: the Screen Wake Lock
API is unavailable in Safari on iOS. The setting ships as a feature-detected row that
says so and does nothing else. The screen will dim mid-tap; the action grid's size is
what has to survive that.

### 4.2 Evening, Morning & Day cards

Edit forms, reached from a night's record in History (and from the stale-night
review link on Tonight). Tonight itself no longer links to them: what they ask is
logged on the grid. Each is a single scrolling card of chip rows and native time
fields. Every field is skippable. A suggested time — now, or last night's value — is a
placeholder until it is explicitly accepted; a displayed suggestion is never a stored fact.

The **morning card leads with two equal-weight buttons, Dry night and Wet night**. One tap
records the outcome, completes the review, and nothing else — every other field stays
unknown rather than being guessed. Logging a dry night must be no more expensive than
logging a wet one, or the dataset skews toward the dramatic nights and every rate we
compute is wrong; it must also carry no more celebration, because this is not something a
four-year-old controls.

Tapping Dry on a night that already holds a `wet` event refuses and names the conflict.
An outcome never deletes an event.

### 4.3 History

- A scrollable list of nights, one row each: date, a dry/wet dot, time of first wetting,
  event icons. Tap any row to open and edit it — correcting yesterday at breakfast is a
  first-class flow, not an afterthought.
- Below it, the metrics (§5).
- Export button.

### 4.4 Navigation

Three tabs, and **one back button in the header**, top-left, on every screen that has
somewhere to go. It returns to the screen this session came from — the same thing the
phone's back gesture does, so the two never disagree — and on a cold deep link falls back
to the route's parent. No screen carries its own "Back to …" row, and no screen links
sideways to a sibling (Privacy → Backup, Export → Backup, Summary → Export, and the like
are gone): a screen links only to its own children. Saves, cancels and deletes navigate
with *replace*, or pop when they return to the screen the draft was opened from, so
backing out of a night never lands on the edit form it just left. History's
Nights / Patterns / Routines control is a segmented view of one tab, not a link maze,
and stays.

## 5. Metrics — the part that answers the questions

Defined precisely so the charts are never ambiguous. Every rate displays its `n` and its
excluded count. Below 10 eligible records, show the actual counts and "not enough recorded
nights for a comparison yet" instead of a rate — but never dim the whole chart, which makes
an honest limitation look like a rendering failure.

The table below states what each metric is *for*. The exact denominators, missing-data
rules, and eligibility thresholds are in
[UX-HANDOFF.md § P01–P03](UX-HANDOFF.md#p01p03--patterns-and-comparisons), which is
stricter than this table and is what gets built.

| Metric | Definition | Answers |
|---|---|---|
| **Wet nights / week** | rolling 7-day and 28-day rate of nights with ≥1 `wet` | Diaper or no diaper |
| **Time to first wetting** | `first wet.t − evening.asleepAt`, in hours, plotted per night | Early+soaked vs late+damp point at different causes |
| **Wettings per night** | count of `wet` events on wet nights | >1 per night suggests bladder overactivity |
| **Arousal rate** | `wet` with `noticed:"self"` ÷ all `wet`, 28-day | Is she starting to wake up for it — the slowest and most meaningful trend |
| **Self-toilet nights** | nights with ≥1 `selfToilet` | The success behaviour, tracked separately from dryness |
| **Fluid load vs outcome** | wet rate split by evening drink volume after dinner | Does the evening drink rule matter *for her* |
| **Last-toilet timing vs outcome** | wet rate split by minutes between last toilet and asleep | Same |
| **Lift effectiveness** | P(dry \| lift night) vs P(dry \| no lift), with n on both sides | Is getting up at 23:30 buying anything |
| **Constipation overlay** | wet rate on nights following `stool: hard` or `none` | The most commonly missed contributor |

Charts are hand-rolled inline SVG. No chart library — these are five simple plots and a
dependency would cost more than it saves for an offline app with no build step.

### Experiments view

Pick an experiment, see its window's wet rate against the equal-length window before it,
with both `n`s. This is the only honest way to evaluate a routine change, because otherwise
you will change three things at once and learn nothing from any of them.

### Export

- **CSV** — one row per night, flattened. Opens in any spreadsheet.
- **JSON** — full fidelity, the backup format.
- **Summary sheet** — a printable one-pager: wet nights/week trend, arousal rate, daytime
  symptoms, bowel pattern, sleep signs. This is what you hand to the pediatrician, and it
  is deliberately organised the way they will ask about it.

## 6. Clinical context worth building around

Not medical advice — just what shapes the schema, and what a doctor will ask:

- At 4, night dryness often isn't developmentally established yet. The clinical threshold
  for calling it enuresis at all is **age 5+**. This log will most likely inform
  "change routine or simply wait" rather than "something is wrong".
- **Constipation** is the most commonly missed contributor — a loaded rectum reduces
  functional bladder capacity. Hence `day.stool` on the following-day card, compared
  against the *next* night's outcome.
- **Sleep-disordered breathing** (snoring, mouth breathing) is the second. Hence `sleepSigns`.
- **Daytime symptoms** (urgency, holding, daytime accidents) are what separate isolated
  night wetting from something broader. Only daytime accidents are still recorded: the
  parent is not with her through the day, and a field that is never filled in is worse
  than no field (it reads as "no" to anyone skimming the sheet).
- Volume and timing matter: large volume early in the night, with no waking, points somewhere
  different than small volumes repeatedly through the night.

## 7. Tech

| Concern | Choice | Why |
|---|---|---|
| App | Vanilla HTML/CSS/JS ES modules, no build step | Zero toolchain rot. Editable from any machine. Deploy = git push. |
| Hosting | GitHub Pages, public repo | Free forever, HTTPS (required for service workers). |
| Install | PWA: `manifest.webmanifest`, `display: standalone`, apple-touch-icon, midnight theme-color | Home-screen icon, no browser chrome, its own storage jar. |
| Offline | Service worker, cache-first on the shell | The app must work in airplane mode at 3am. |
| Storage | `localStorage`, single JSON blob, + `navigator.storage.persist()` | Synchronous, atomic, tiny at this scale. IndexedDB buys nothing here. |
| Charts | Hand-rolled SVG | No dependency, no CDN, works offline. |

**Privacy note:** the repo is public but the data never is — everything stays in the browser
on the phone. Do not commit exports.

### File layout

```
index.html            includes the inlined SVG icon sprite
app.css
sw.js                 must stay at the repo root so its scope covers the app
manifest.webmanifest
icons/                app icons
assets/  icons.svg  art/
js/  app.js  store.js  model.js  ui.js  tonight.js  cards.js  history.js
     patterns.js  metrics.js  charts.js  routines.js  backup.js  summary.js
     more.js  selftest.js  selftest-metrics.js
tools/  make_sprite.py  make_art.py
docs/  DESIGN.md  IMPLEMENTATION.md  UX-HANDOFF.md  VISUAL-DIRECTION.md  ux/  demo/
```

The icon sprite is inlined into `index.html` rather than referenced as an external
file: WebKit does not support external document references in `<use>`, so
`<use href="icons.svg#moon">` renders nothing in Safari.

## 8. Reminders — deliberately out of the app

iOS does not give web apps reliable scheduled local notifications, and building a push
backend for two daily nudges is absurd. Instead, set these up once on the phone:

- Two repeating **Reminders / alarms**: one at bedtime ("fill evening card"), one at wake-up
  ("morning review"). An Apple **Shortcut** that opens the PWA URL directly makes each a
  single tap from the notification.
- In-app, Tonight shows a quiet badge when the evening card is unfilled, and History shows
  one when a past night is incomplete.

## 9. The real risk: one device, no sync

Single-device local storage means a lost, reset, or wiped phone loses everything, and iOS can
evict site data (installed PWAs are far more protected than Safari tabs, but not immune).

Mitigations, all in v1:

1. `navigator.storage.persist()` requested at first launch.
2. A bare **Export JSON** button, shipped in **M1** rather than with the rest of this
   section. The risk starts the night the first real event is logged, not the week the
   backup flow gets designed. M5's B01 replaces it.
3. **Weekly backup nudge** — on Sundays, once the outcome is recorded, Tonight's day phase
   (and the morning card) surfaces a Backup button that exports JSON via the Web Share
   sheet, straight into Files / iCloud Drive. One tap.
4. A "last backup: N days ago" indicator that turns amber past 10 days.
5. An Import screen that accepts a pasted or picked JSON file, so recovery actually works.

Adding real sync later is a contained change: the store is a single JSON document behind a
thin module, so a sync layer slots in behind `store.js` without touching any screen.

## 10. Build order

Ship M0 and M1 first and start collecting real data within a day. The schema will want to
change once real nights hit it, and it is much cheaper to learn that from three logged nights
than from a finished app.

| | Milestone | Outcome |
|---|---|---|
| **M0** | Repo, empty shell, manifest, service worker, deployed to Pages | **Prove the install + offline story works on the actual phone before building anything.** If this fails, nothing else matters. |
| **M1** | Visual system + store + Tonight + 5 actions + detail + undo + one-tap dry/wet outcome + bare JSON export | **Usable tonight.** Night events are the data we cannot reconstruct later, the outcome is the denominator every §5 rate needs, and the export means the first weeks survive a lost phone. |
| **M2** | Full evening, morning, and following-day cards | Full nightly record |
| **M3** | History list + editing past nights | Fix mistakes, backfill |
| **M4** | Metrics + charts | The decisions become answerable |
| **M5** | Routines, export, backup, restore, More, welcome | Routine changes and the doctor visit |

Per-milestone pass/fail bars, commit sequence, and verification steps are in
[IMPLEMENTATION.md](IMPLEMENTATION.md).

M2 can trail M1 by a few days — the evening and morning are calm enough to note on paper in
the meantime. Do not let M4 block data collection.

M1 carries the visual system as well, at the user's decision. It lands as five separately
verified commits — assets, store, Tonight, outcome, export — so that a visual bug and a data
bug never arrive in the same diff.
