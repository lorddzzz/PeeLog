# Feature-to-design coverage

All original M0–M5 feature areas have a basic UX treatment. The atlas is a linked
screen reference; forms, calculations, records, and file operations are not implemented.

| Original scope | Atlas studies | Supporting contract |
| --- | --- | --- |
| M0 install, home-screen entry, offline, storage checks, updates | W01, W02, M03, S01 | Welcome/install; shared edge states |
| M1 current night and first-tap save | T01, T02 | Interaction rules; night identity |
| M1 five event types and all optional fields | E01–E05 | Event-detail field matrix |
| M1 saved strip, details, Undo, failure | T01, E01–E05, S01 | Save only after persistence succeeds |
| M2 diaper/pull-up, all evening fields, repeated drinks | R01 | Evening field matrix; explicit no-drinks addition |
| M2 morning outcome, time, changes, mood, sleep signs, note | R02, R04, S01 | Morning and contradiction flow |
| M2 following-day observations | R03 | Day/date association and unknown values |
| M3 history, empty/gaps, review-due, editing | H01–H04 | Night detail and correction rules |
| M3 backfill, date correction, duplicate night, removal | H04–H06 | Date-boundary and deletion rules |
| M4 wet-night 7/28-day view | P01 | Counts, coverage and weekly normalisation |
| M4 first wetting and frequency | P02 | Missing asleep/event detail, units |
| M4 noticing and self-toilet nights | P01 | Eligible-event/nights denominators |
| M4 drinks, toilet timing, lift comparison, bowel overlay | P03 | Group thresholds, missingness, date matching |
| M5 routine list/create/edit/end and before/during | X01–X04 | Equal calendar windows; active routine rules |
| M5 CSV, full JSON, summary preview | O01–O03, B01/B04 | Range versus full backup; cancelled/failed share |
| M5 printable one-pager | O02 + report.html | Coverage, night/day/bowel/sleep/routine/parent note |
| M5 weekly nudge and overdue backup | R04, B01 | After-review placement; timestamp honesty |
| M5 pick/paste restore, validation, preview, duplicates | B02–B03, S01 | No silent overwrite or partial import |
| M5 replacement confirmation, backup first, result | B04–B07 | Explicit scope and cancel path |
| Appearance, decorative art, keep awake | M02, T02 | All-dark v1; no layout jump when art hidden |
| Privacy and external reminders | M03 | Local records and no in-app scheduled alarm |
| Shared failure/unknown/conflict states | S01; UX-HANDOFF.md state matrix | Save failure, time validation, unsupported states |
| Reusable UI and identity assets | A01; ASSETS.md; tokens.json | Icons, illustrations, app icon sizes, typography |

## Screen-study limits

The atlas links visual examples rather than processing form selections. Repeated
drink rows, steppers, filters, sample outcomes, and share actions illustrate layout;
the UX handoff defines their future behaviour. Some edge states share one screen
study and have distinct copy in the specification rather than one mockup each.

No account, sync, multi-child profiles, notifications backend, medical decision
engine, or gamification is added. A light daytime theme is deferred; print is an
explicitly selected light preview.

## Changes to reconcile before implementation

- Neutral outcome treatment replaces the original confetti proposal.
- Optional details have no timer.
- Explicit unknown values, no-drinks confirmation, and event-completeness answers
  prevent empty data from being interpreted as negative observations.
- The 7-day view shows counts; the sample threshold applies to rates/comparisons.
- Each metric discloses its eligible denominator and excluded records.
- Stale active nights do not absorb a new evening's events.
- Import supports add-missing by default and explicit whole-log replacement.
- `docs/UX-HANDOFF.md` is the interaction reference; `docs/DESIGN.md` retains the
  original product and technical background.
