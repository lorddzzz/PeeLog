# PeeLog — Design & Scope v1

A night-wetting tracker for one child, built for the person logging at 3am.

**Design handoff:** the approved visual direction and complete basic UX are now
documented in [UX-HANDOFF.md](UX-HANDOFF.md), with a [screen atlas](ux/index.html)
and [asset library](ux/ASSETS.md). That handoff supersedes this document's earlier
visual and interaction proposals, and explicitly lists data-definition issues
to reconcile during implementation. This file retains the original scope and
technical background.

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

```jsonc
{
  "version": 1,
  "activeNightId": "2026-09-13",   // null when no night is open
  "nights": [ /* Night */ ],
  "experiments": [ /* Experiment */ ],
  "settings": { "lastBackupAt": "2026-09-13T08:00:00+02:00" }
}
```

### Night

Keyed by the date of the **evening**. The night of Sep 13 → morning of Sep 14 is `"2026-09-13"`.

```jsonc
{
  "id": "2026-09-13",
  "diaper": "none",                  // none | pull-up | diaper   (what she wore)
  "experimentId": "exp-1" | null,

  "evening": {
    "dinnerAt": "18:30",
    "drinks": [ { "at": "19:10", "size": "cup" } ],   // sip | cup | lots
    "lastToiletAt": "20:05",
    "lastToiletOutput": "some",      // none | some | lots
    "lightsOutAt": "20:20",
    "asleepAt": "20:45",
    "asleepEstimated": true,
    "dayContext": ["nap", "excited"],// nap | excited | unwell | away | new-place | late-nap
    "note": ""
  },

  "events": [ /* Event, sorted by t */ ],

  "morning": {
    "wakeAt": "06:50",
    "outcome": "wet",                // dry | wet  — confirmed, not just derived
    "changes": 1,                    // how many full changes of sheets/clothes
    "mood": "ok",                    // upset | ok | happy
    "sleepSigns": ["snoring"],       // snoring | mouth-breathing | restless | none
    "note": ""
  },

  "day": {                           // the day AFTER this night; filled at next evening, optional
    "toiletCount": 6,
    "urgency": false,                // sudden desperate "I need to go NOW"
    "holding": false,                // crossing legs, squatting, holding maneuvers
    "accidents": 0,                  // daytime wetting
    "stool": "normal",               // none | hard | normal | loose
    "fluids": "normal"               // low | normal | high
  }
}
```

### Event

```jsonc
{ "id": "e1", "t": "2026-09-14T02:12:00+02:00", "type": "wet", /* + type-specific fields */ }
```

| type | meaning | optional detail |
|---|---|---|
| `wet` | bed is wet | `amount`: damp \| wet \| soaked · `noticed`: self \| parent · `changed`: [sheets, pajamas] |
| `selfToilet` | **she woke and asked / went to pee** | `output`: none \| some \| lots · `madeIt`: true \| false |
| `lift` | I carried her to the potty | `output`: none \| some \| lots · `woke`: true \| false |
| `drink` | she asked for water | `size`: sip \| cup |
| `wake` | woke / cried, not pee-related | `note` |

`selfToilet` is the single most important event type. It is the behaviour we are trying to
grow, and a night with a `selfToilet` and no `wet` is a qualitatively different success from
a night that was simply dry.

### Night boundary

An explicit `activeNightId` is opened by the evening card (or by the first night event) and
closed by the morning review. On a cold start with no active night, fall back to: events
between 15:00 and 14:59 the next day belong to the night dated at the earlier 15:00.

Timestamps are stored as full ISO-8601 **with offset**, so daylight-saving changes and travel
don't silently corrupt the "hours after falling asleep" metric.

### Experiment

```jsonc
{ "id": "exp-1", "name": "No drinks after 18:30", "from": "2026-09-14", "to": null, "note": "" }
```

## 4. Screens

Three. No navigation drawer, no settings maze. A tab bar of three items.

### 4.1 Tonight — the home screen, and the only one that matters at 3am

Opens directly to the active night. Pure black background, dim desaturated accents, large
type. Buttons are a 2×3 grid filling the lower two-thirds of the screen (thumb zone):

```
┌─────────────────┬─────────────────┐
│  🚽 She asked   │   🌙 I lifted   │
│     to pee      │       her       │
├─────────────────┼─────────────────┤
│   🥤 Water      │   😢 Woke up    │
├─────────────────┴─────────────────┤
│         💧 WET BED                │   ← widest, lowest, hardest to miss
├───────────────────────────────────┤
│  02:12 wet · soaked      ↩ undo   │   ← last event strip
└───────────────────────────────────┘
```

Interaction on any button:

1. Tap → event committed at `now`, haptic buzz, saved. **Done. You can put the phone down.**
2. A detail row of chips slides up (e.g. `damp | wet | soaked`, then `woke herself | I found it`).
3. Chips are one tap each, no confirm. The sheet auto-dismisses after ~8s of no interaction.
4. The last-event strip always offers a single `↩ undo`.

Above the grid, a compact summary of the night so far (asleep 20:45 · 1 lift · 1 wet).

No white flashes, no animations that draw attention, no sounds. Optional screen-wake-lock
while the app is foregrounded so it doesn't dim mid-tap.

### 4.2 Evening & Morning cards

Reached from Tonight; each is a single scrolling card of chip rows and time steppers.
Every field is skippable. Times default to sensible values (now, or last night's value).

The **morning card leads with one enormous "Dry night 🎉" button** that fills in the whole
card in one tap. Logging a dry night must be cheaper than logging a wet one, or the dataset
skews toward the dramatic nights and every rate we compute is wrong.

### 4.3 History

- A scrollable list of nights, one row each: date, a dry/wet dot, time of first wetting,
  event icons. Tap any row to open and edit it — correcting yesterday at breakfast is a
  first-class flow, not an afterthought.
- Below it, the metrics (§5).
- Export button.

## 5. Metrics — the part that answers the questions

Defined precisely so the charts are never ambiguous. Every rate displays its `n`, and
anything computed from fewer than 10 nights is shown greyed with "not enough nights yet".

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
  functional bladder capacity. Hence `day.stool`, and it's why the morning card asks.
- **Sleep-disordered breathing** (snoring, mouth breathing) is the second. Hence `sleepSigns`.
- **Daytime symptoms** (urgency, holding, daytime accidents) are what separate isolated
  night wetting from something broader. Hence the `day` block.
- Volume and timing matter: large volume early in the night, with no waking, points somewhere
  different than small volumes repeatedly through the night.

## 7. Tech

| Concern | Choice | Why |
|---|---|---|
| App | Vanilla HTML/CSS/JS ES modules, no build step | Zero toolchain rot. Editable from any machine. Deploy = git push. |
| Hosting | GitHub Pages, public repo | Free forever, HTTPS (required for service workers). |
| Install | PWA: `manifest.webmanifest`, `display: standalone`, apple-touch-icon, black theme-color | Home-screen icon, no browser chrome, its own storage jar. |
| Offline | Service worker, cache-first on the shell | The app must work in airplane mode at 3am. |
| Storage | `localStorage`, single JSON blob, + `navigator.storage.persist()` | Synchronous, atomic, tiny at this scale. IndexedDB buys nothing here. |
| Charts | Hand-rolled SVG | No dependency, no CDN, works offline. |

**Privacy note:** the repo is public but the data never is — everything stays in the browser
on the phone. Do not commit exports.

### File layout

```
index.html
app.css
js/  store.js  model.js  tonight.js  cards.js  history.js  metrics.js  export.js  sw.js
manifest.webmanifest
icons/
docs/DESIGN.md
```

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
2. **Weekly backup nudge** — on Sundays the morning card surfaces a Backup button that exports
   JSON via the Web Share sheet, straight into Files / iCloud Drive. One tap.
3. A "last backup: N days ago" indicator that turns amber past 10 days.
4. An Import screen that accepts a pasted or picked JSON file, so recovery actually works.

Adding real sync later is a contained change: the store is a single JSON document behind a
thin module, so a sync layer slots in behind `store.js` without touching any screen.

## 10. Build order

Ship M0 and M1 first and start collecting real data within a day. The schema will want to
change once real nights hit it, and it is much cheaper to learn that from three logged nights
than from a finished app.

| | Milestone | Outcome |
|---|---|---|
| **M0** | Repo, empty shell, manifest, service worker, deployed to Pages | **Prove the install + offline story works on the actual phone before building anything.** If this fails, nothing else matters. |
| **M1** | Store + Tonight screen + 5 buttons + detail chips + undo | **Usable tonight.** Night events are the data we cannot reconstruct later. |
| **M2** | Evening & morning cards, dry-night one-tap | Full nightly record |
| **M3** | History list + editing past nights | Fix mistakes, backfill |
| **M4** | Metrics + charts | The decisions become answerable |
| **M5** | Experiments, export, backup nudge, import | Routine changes and the doctor visit |

M2 can trail M1 by a few days — the evening and morning are calm enough to note on paper in
the meantime. Do not let M4 block data collection.
