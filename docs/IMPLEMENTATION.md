# PeeLog — implementation plan

13 September 2026. How the app gets built and in what order.
[DESIGN.md](DESIGN.md) is the product and technical spec;
[UX-HANDOFF.md](UX-HANDOFF.md) is the interaction and visual spec;
this file is the build.

Where the two specs disagreed, the reconciliation is recorded in §1 and applied
to `DESIGN.md` itself, so there is still one source of truth per question.

## 1. Reconciled decisions

Settled with the user on 13 September:

| Question | Decision |
| --- | --- |
| Re-skin vs logging | Both land in M1, as five separately verified commits (§4) |
| Third tab | Tonight / History / **Check** until M5, then Check moves into More |
| M1 scope | Includes the one-tap Dry / Wet morning outcome, not the rest of R02 |
| Early export | Accepted — a bare JSON export lands in M1, not M5 (§4, commit 1e) |
| Time and date entry | Native `input type="time"` / `type="date"` |

Corrections to `DESIGN.md`, applied there:

1. **§3 stored bare local times** (`"dinnerAt": "18:30"`) while its own closing
   paragraph requires full ISO-8601 with offset. Bare times are exactly what
   corrupts *time to first wetting* across a DST change or a trip. Every stored
   instant is now ISO-8601 with offset. Night `id` stays a plain local date —
   it is a label, not an instant.
2. **§3 could not express "unknown"**. `changes: 1` and `urgency: false` gave no
   way to say *not asked*. The handoff's denominator rules depend on that
   distinction, so every optional field is now `null` until answered, and
   `false` / `0` / `"none"` mean someone actually answered.
3. **§3 gained two fields** the handoff requires: `evening.noDrinks` and
   `morning.eventsComplete`. An empty `drinks` array is unknown; `noDrinks: true`
   is a confirmed none. Same for event completeness.
4. **§4.1's screen wake lock is not buildable.** The Screen Wake Lock API is not
   available in Safari on iOS. The setting ships as a feature-detected row that
   reports *Not available on this browser* and does nothing else.
5. **§4.2's "Dry night 🎉" and "fills in the whole card"** are replaced by the
   handoff's equal-weight Dry / Wet, which records the outcome and nothing else.
6. **§4.3 / §5 metrics** take the handoff's denominators, which are stricter.

## 2. Architecture

### Modules

Every module is an ES module with relative `.js` specifiers. No module except
`store.js` touches `localStorage`.

```
js/app.js        boot, hash router, tab bar, SW registration, first-run persist()
js/store.js      the single writer; load / update / subscribe; quota failure
js/model.js      schema shape, night id and boundary, event helpers, validation
js/ui.js         shared DOM: chip group, field row, time field, icon, saved strip
js/tonight.js    T01–T02, E01–E05, the three-phase grid
js/cards.js      R01 evening, R02 morning, R03 following day          (M2)
js/history.js    H01–H06 list, night detail, event edit, backfill     (M3)
js/metrics.js    pure functions over the document, no DOM             (M4)
js/charts.js     hand-rolled SVG: bar series, dot plot, comparison    (M4)
js/routines.js   X01–X04                                              (M5)
js/backup.js     CSV, JSON, summary sheet, restore                    (M5)
js/more.js       M01–M03, W01–W02                                     (M5)
js/selftest.js   the Check tab — the closest thing to a test suite
```

`app.css` stays one file with the existing `/* ── Name ── */` banners. Splitting
it would only add requests to the service-worker shell.

### Store contract

```js
createStore(storage = localStorage, key = 'peelog:v1')  // injectable for tests
store.get()                 // current in-memory document, never mutate directly
store.update(fn)            // fn(draft) → mutate, then whole-document write
store.subscribe(fn)         // re-render on change
```

`update` writes the whole document with `JSON.stringify`. A `QuotaExceededError`
leaves the in-memory document untouched, returns a failure, and the caller shows
the S01 *Not saved* state. Nothing shows *Saved* before the write returns.

At boot, before any mutation, the loaded document is copied to `peelog:v1:prev`.
A bad deploy that corrupts the live document then still has last session's copy
sitting next to it.

### Router

Hash routes, so the phone's back gesture works and handoff rule 7 (back keeps
committed fields) comes for free.

```
#/tonight  #/event/<id>  #/evening/<nightId>  #/morning/<nightId>  #/day/<nightId>
#/history  #/night/<nightId>  #/patterns  #/routines  #/more  #/check  #/summary
```

A cold launch always lands on `#/tonight` regardless of the restored hash
(handoff rule 8). Within a session the hash is authoritative.

### Night identity

```js
nightIdFor(date)   // local date if hour >= 15, else the previous local date
```

`activeNightId` is explicit, opened by the evening card, the first event of the
night, or the morning review. When `activeNightId` is older than
`nightIdFor(now)`, Tonight shows the new night, logs into the new night, and
carries a compact *Sunday still needs a review* link. The stale night never
absorbs the new evening's events.

### Icons

The design package's `<use href="icons.svg#name">` pattern does not work in
Safari — WebKit has never supported external document references in `<use>`.
The sprite is therefore inlined into `index.html` as a hidden `<svg>` of
`<symbol>`s, and `tools/make_sprite.py` regenerates that block from
`assets/icons.svg` between markers. 4.4 KB in a file that is precached anyway,
and one fewer request.

*Assumption:* this is a long-standing WebKit limitation. If it turns out to be
fixed on the target iOS version, the external file still exists and the block
can be dropped — but inlining is correct either way, so this is not a blocker.

### Illustrations

The package originals are 1.3–1.5 MB, far too heavy for a 140 px vignette and
for the offline shell. `tools/make_art.py` produces 560 px JPEGs with the
built-in macOS `sips` — 13 KB each, no banding on the dark ground, small enough
to precache. Originals stay in `docs/ux/assets/` as the source.

This makes the palette decision for us: the art carries a baked `#10151E`
ground, so the app background must be the token value, not the current
`#07090D`. `tokens.json` is adopted verbatim.

## 3. Data model — final shape

`localStorage["peelog:v1"]`. `version` stays `1`; M0 never wrote a document, so
there is nothing to migrate. `migrate(doc)` ships from M1 anyway — restore has
to reject a future version with its own message, and the hook needs to exist
before real nights depend on it.

`null` means **not answered**. `false`, `0`, and `"none"` mean someone answered.

```jsonc
{
  "version": 1,
  "activeNightId": "2026-09-13",
  "nights": [ /* ascending by id */ ],
  "experiments": [],
  "settings": { "lastBackupAt": null, "lastBackupConfirmedAt": null, "art": true }
}
```

### Night

```jsonc
{
  "id": "2026-09-13",                 // local date of the evening; a label, not an instant
  "diaper": null,                     // null | none | pull-up | diaper
  "experimentId": null,

  "evening": {
    "dinnerAt": null,                 // ISO-8601 with offset
    "drinks": [ { "id": "d1", "at": "2026-09-13T19:10:00+02:00", "size": "cup" } ],
    "noDrinks": null,                 // null unknown | true confirmed none
    "lastToiletAt": null,
    "lastToiletOutput": null,         // null | none | some | lots
    "lightsOutAt": null,
    "asleepAt": null,
    "asleepEstimated": false,
    "dayContext": [],                 // nap | excited | unwell | away | new-place | late-nap
    "note": ""
  },

  "events": [],                       // sorted by t

  "morning": {
    "outcome": null,                  // null review due | dry | wet
    "wakeAt": null,
    "changes": null,                  // null unknown; 0 is an answer
    "mood": null,                     // upset | ok | happy
    "sleepSigns": null,               // null unknown | ["none"] exclusive | [...]
    "eventsComplete": null,           // null | true — gates comparison eligibility
    "note": ""
  },

  "day": {                            // the day AFTER this night
    "toiletCount": null,
    "urgency": null,
    "holding": null,
    "accidents": null,
    "stool": null,                    // null no record | none | hard | normal | loose
    "fluids": null                    // null | low | normal | high
  }
}
```

`morning.outcome !== null` was the definition of *reviewed*. **Superseded on 19
September 2026** — the outcome is derived from the night's own record and
nothing writes the field; DESIGN.md §3 has the rule. The schema block above is
left as M1 built it, retired fields and all.

### Event

```jsonc
{ "id": "e-k3f9x2", "t": "2026-09-14T02:12:00+02:00", "type": "wet",
  "amount": null, "noticed": null, "changed": [] }
```

All type-specific fields start `null` (or `[]` for multi-select). Tapping a
selected chip clears it back to `null` — unknown must be reachable again after a
mistaken tap.

| type | fields |
| --- | --- |
| `wet` | `amount` damp/wet/soaked · `noticed` self/parent · `changed` [sheets, pyjamas] |
| `selfToilet` | `output` none/some/lots · `madeIt` true/false |
| `lift` | `output` none/some/lots · `woke` true/false |
| `drink` | `size` sip/cup |
| `wake` | `note` string |

A `selfToilet` with `madeIt: false` never manufactures a `wet` event. E02 offers
an explicit *Also need to log a wet bed?* link instead.

### Day-to-night association

`night["2026-09-13"].day` describes **Monday 14 September**, the day after that
night. The bowel overlay therefore compares night N's outcome against night
**N−1**'s `day.stool`. Easy to get backwards; asserted in the self-test.

## 4. M1 — re-skin and real logging

**Pass/fail bar.** On a phone, in a dark room, with the app launched from the
home screen and Airplane Mode on: five taps record five events that survive a
force-quit and relaunch; each event's optional detail is reachable and saves;
undo removes the latest event only; a morning outcome of Dry or Wet is recorded;
a Dry tap on a night with a wet event refuses and explains; the logged nights
come back out of the app as a JSON file. Console clean.

The user chose to land the visual system and logging together. Mitigation is
sequence: five commits, each verified before the next, so a visual bug and a
data bug never arrive in the same diff.

### 1a · Visual system

- Copy `docs/ux/assets/brand/*.png` over `icons/`, `icons.svg` and the 40 icon
  files to `assets/`, art derivatives to `assets/art/`.
- `app.css` `:root` adopts `tokens.json` verbatim; add `color-scheme: dark` so
  native pickers render dark.
- Inline sprite block in `index.html`; emoji removed; every event action becomes
  icon + text, with `WET BED` recased to `Wet bed`.
- `manifest.webmanifest` icons repointed. `tools/make_icons.py` is deleted — the
  droplet it generates is no longer the identity — and AGENTS.md's Commands
  section updated to match.
- `sw.js`: add `assets/icons.svg`, both art JPEGs, and the new icon paths to
  `SHELL`; bump `CACHE` to `peelog-shell-v2`.

**Verify:** serve locally, reload twice, confirm `peelog-shell-v2` is live and
v1 was deleted; Airplane Mode relaunch still renders art and icons.

### 1b · Store and model, no UI

`store.js`, `model.js`, `migrate()`, first-run `navigator.storage.persist()`.
Extend `selftest.js` with an in-memory-backed store and assert: document
round-trip; quota failure leaves the document intact; `nightIdFor` at 14:59,
15:00, and across a DST change; event insert keeps `t` order; undo removes only
the latest; day-to-night association.

**Verify:** the Check tab is green and the real store is untouched by the tests.

### 1c · Tonight

T01 / T02 wired to the store, E01–E05 detail views, undo, and the S01 *Not
saved* state. Details have no dismissal timer. The Evening link is absent until
M2 rather than dead.

### 1d · Morning outcome

`#/morning/<id>` with the two equal-weight buttons, the wet-conflict flow, and
the R04 confirmation. The rest of R02 fills in this same route at M2. (All
three were removed on 19 September 2026 with the move to a derived outcome.)

### 1e · Escape hatch

A bare **Export JSON** button on the Check tab. `JSON.stringify` the document
into a `Blob`, `URL.createObjectURL`, click a synthetic `<a download>` named
`peelog-YYYY-MM-DD.peelog.json`, revoke the URL. No share sheet, no date range,
no design — the M5 backup flow (B01) replaces it.

DESIGN.md §9 names single-device storage as the real risk, and M1 is the point
where nights that cannot be reconstructed start accumulating. Without this the
first weeks are unrecoverable until M5.

The `.peelog.json` suffix is already gitignored, so an export that lands in the
repo directory cannot be committed by accident.

**Verify:** log two events, export, open the file, confirm both events and their
offsets are present. Then confirm `git status` stays clean with the file in the
working directory.

*Not verified from here:* whether iOS standalone mode offers a usable
destination for a `blob:` download. If it does not, this becomes a
`navigator.share` call at M5 and the desktop browser stays the escape hatch in
the meantime — say so rather than letting it look like it worked.

## 5. M2–M5

Each milestone keeps the pass/fail form: a concrete thing done on the phone, not
a diff read.

| | Scope | Pass/fail bar | Self-test additions |
| --- | --- | --- | --- |
| **M2** | R01 evening, full R02 morning, R03 following day | A whole night — evening, events, morning, next day — records end to end, every field skippable, suggested times unsaved until tapped | Suggested-value acceptance; `noDrinks` vs empty; exclusive `none` in sleep signs |
| **M3** | H01–H06 list, night detail, event edit and delete, backfill, delete night | Yesterday is corrected at breakfast: move an event across the 15:00 boundary, change its type, delete it, undo the delete | Boundary move reassigns nights; duplicate backfill opens the existing night; type change clears only incompatible fields |
| **M4** | P01–P03 and `charts.js` | Every figure states its denominator and excluded count; nothing under threshold shows a rate | Each metric against hand-checked fixtures — the most error-prone code in the app |
| **M5** | X01–X04, O01–O03, B01–B07, M01–M03, W01–W02, Check moves into More | A backup is created, the log is wiped, and the backup restores it; the summary sheet prints | CSV escaping; restore validation; no partial import on failure |

M4's fixtures are the priority: a metric that is quietly wrong is worse than a
metric that is missing, because it will be used to make one of the three
decisions in §1 of DESIGN.md.

## 6. Standing rules for every commit

- Bump `CACHE` in `sw.js` whenever a `SHELL` file changes, in the same commit,
  and add new shell files to the list.
- Relative paths only. Pages serves from `/<repo>/`.
- Verify on `http://localhost:8000`, never `file://`.
- After a shell change, reload twice and confirm the old cache was deleted.
- Extend `selftest.js` with whatever the commit should have asserted.

## 7. What only the phone can settle

Hand back to the user after each milestone, never claimed as verified:

- Install, standalone mode, and safe-area insets on the real device.
- Dark-room legibility of the token palette and the art's ground.
- Native time and date pickers in a dark room — appearance, size, and whether
  setting 18:30 is genuinely fewer taps than a stepper would have been.
- Thumb reach of the action grid at the phone's real height.
- iOS storage eviction over weeks, and whether `persist()` was granted.
- Whether a `blob:` download has a usable destination in iOS standalone mode —
  needed by the M1 export, not just by M5's share sheet.
- `navigator.share` with a JSON file (M5).
- Printing the summary sheet from iOS (M5).
- VoiceOver and large text settings.
