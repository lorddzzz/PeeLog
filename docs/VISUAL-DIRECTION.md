# PeeLog — visual direction

Status: first visual study approved; full basic UX package, 13 September 2026. The user chose
a middle ground between Quiet bedside and Gentle companion: soft, easy to use,
focused on dark nighttime use, with a supporting illustration. Exact screen
treatment was approved as the basis for all features. This document is the reference for UX, UI, and
assets as decisions are made. It does not change the app's implementation.

## Full basic UX package

The user approved the Quiet company demo and requested basic UX for all features
and all needed assets, with implementation separate. The resulting
[UX handoff](UX-HANDOFF.md) and [41-study screen atlas](ux/index.html) extend this
direction across the original M0–M5 scope. The [asset inventory](ux/ASSETS.md)
includes 40 vector interface icons, two matching illustrations, a vector brand
mark and wordmark, six app-icon PNG exports, and design tokens.

The package uses dark appearance throughout v1, with light reserved for an
explicitly opened printable summary. Daytime theme exploration is deferred.
The new handoff settles interaction proposals below; these earlier sections
remain as the design rationale and discovery history.

## First visual study: Quiet company

[Open the interactive demo](demo/index.html). Serve the repository locally and
visit `/docs/demo/` to try it. The existing app remains separate from this study.

The study combines midnight and blue-slate surfaces, oatmeal accents, a restrained
clay Wet bed action, and a sleepy moon resting on a pillow. The illustration is
decorative, static, and confined to the header. Action labels use system sans-serif;
the Tonight heading experiments with a soft editorial serif for a little warmth.

Included: Tonight, optional details and Undo, sample History, a minimal morning
outcome interaction, and an illustration toggle. All entries are in-memory sample
data; the demo clock uses 02:12 and does not write to the real PeeLog store.

Palette under review: midnight `#10151E`, action surface `#1B2432`, text `#E0DFD8`,
secondary text `#A4ADBB`, oatmeal `#D6C9AC`, and clay accent `#D0A893`.

This study tests the balance of illustration and function. The amount of
illustration, serif heading, and precise palette are proposals, not approved details.
Daytime appearance remains undecided. Production logging and data validation are
outside this visual demo. Illustration provenance and its complete generation
prompt are recorded in [demo/ASSETS.md](demo/ASSETS.md).

Demo verification: inspected desktop and 390 px phone layouts, checked wrapping
and horizontal overflow at 320 px, and exercised logging, optional details, Undo,
morning outcome propagation to History, and the illustration toggle. Real-device
dark-room legibility and full accessibility validation remain for detailed design.

## Product foundation

PeeLog is a private, offline night-wetting log for one child, used primarily by
a tired parent in a dark bedroom. It also supports calmer evening preparation,
morning completion, and reviewing patterns across nights.

The design must serve two distinct situations:

- **At night:** recognise the right action, tap once, know it saved, put the phone down.
- **During review:** complete missing information, correct mistakes, and understand
  records without treating the child's outcomes as a score.

Source: `README.md`, `docs/DESIGN.md`, `index.html`, `app.css`, `js/app.js`, and
the existing app icon. The current app is an M0 shell: Tonight has temporary
in-memory interactions; History is a placeholder; Check is an installation tool.
This assessment is based on source inspection and viewing the icon, not a
hands-on dark-room usability test.

## Existing commitments to preserve

- The first tap saves. Optional detail must never gate logging.
- Large, stable actions in the thumb zone, with a persistent last-event/undo area.
- No streaks, scores, or gamification.
- No sounds, bright flashes, or attention-seeking motion.
- Plain language, one child's record, local storage, and offline availability.
- History editing is a normal action, not a hidden recovery path.

## Selected direction: Quiet bedside + Gentle companion

**A calm, dependable bedside tool with soft shapes and a quiet illustrated companion.**

Adult-facing, restrained, and immediately legible. Warmth comes from softened
corners, comfortable spacing, carefully chosen muted colour, and matter-of-fact
copy. Nighttime actions remain the visual centre of the product.

| Candidate | Visual character | Main tradeoff |
| --- | --- | --- |
| Quiet bedside — recommended | Near-black surfaces, soft neutral text, restrained blue, rounded line icons | Needs careful contrast so restraint does not become faintness |
| Precise instrument | Crisp geometry, neutral greys, compact records, stronger typographic structure | May feel clinical or emotionally distant |
| Gentle companion | Softer shapes, occasional illustration, more expressive language | Personality can compete with fast logging or feel child-directed |

These are creative directions for this product, not external product comparisons.

## Proposed visual system

### Colour and appearance

Use the current near-black foundation as a starting point, with slightly raised
charcoal surfaces, soft light text, and one muted blue interaction accent.
Avoid giving every event button its own colour.

Keep Wet bed easy to find through its full-width position and explicit label.
A restrained clay accent is a candidate, not an error state. Wet and dry records
must both read as neutral observations; neither should depend on red/green coding.
Use labels and distinct marks alongside colour in history and charts.

Recommendation: Tonight stays dark. Offer an optional warm light appearance for
daytime review, without a clock-driven switch that could brighten a dark room.
The exact theme control and navigation transition need a later interaction decision.

Palette values should be selected on actual screen studies after the personality
is agreed. Dim the overall surface, not the legibility of essential labels.

### Typography, geometry, and hierarchy

- Start with the platform system sans-serif, available offline and familiar on the phone.
- Use sentence case and clear medium-weight action labels.
- Keep primary action text around 18–20 px as an initial study target; body text
  around 16 px. Verify wrapping and larger text settings on narrow phones.
- Use consistent rounded rectangles, approximately 16–20 px corner radii in studies.
- Make all controls at least 44 × 44 CSS px; the five event actions should be
  substantially larger. Optional details must also be comfortably tappable.
- Use a consistent spacing rhythm and quiet separation. Avoid ornamental panels,
  glossy effects, and decorative gradients in the logging interface.
- Prioritise the night/date, event actions, and latest saved event over the app name.

### Icons and assets

Replace the mixed emoji with one coherent set of rounded line icons, always
paired with text. The distinction between child-initiated toileting and a parent
carrying the child must be clear in the wording, even if the icons are unfamiliar.

Keep operational icons simple and render them as local vector assets. Include a
quiet bedtime illustration in the header, separate from night actions. The user
explicitly selected illustration as part of the direction. More illustration in
onboarding or empty history states can be explored later.

The current blue droplet app icon is recognisable but generic. Explore a simplified
droplet or a restrained night motif after the personality is agreed. Judge concepts
at home-screen size and with platform crops before producing export sizes.

Asset work in the next stage: app icon concepts; five event icons; navigation and
utility icons; neutral outcome marks; any agreed empty-state illustration.

### Language and emotional tone

Use calm, factual copy: “Wet bed”, “Saved at 02:12”, “Undo”, “Dry night”, and
“Nothing logged yet”. Event labels remain explicit about what happened and who
initiated it. Preserve the existing child-specific wording unless requested otherwise.

Remove the all-caps treatment of WET BED. Recommend replacing “Dry night 🎉” with
“Dry night” and treating both morning outcomes with equal emotional weight.
Dry logging should remain one tap. Outcome must not fabricate unknown morning details.

Avoid congratulations, failures, goals, broken streaks, and progress language that
implies the child controls every outcome. Distinguish child-initiated toileting in
the record without turning it into a reward.

## Proposed UX expression

| Situation | Design emphasis |
| --- | --- |
| Tonight | Stable 2 × 2 actions plus full-width Wet bed, compact context, saved/undo feedback |
| Optional event details | Non-blocking chips; saved state remains obvious; main actions stay reachable |
| Evening | Skippable groups, readable time controls, minimal typing |
| Morning | One-tap explicit dry/wet outcome, then optional completion; no celebratory hierarchy |
| History | Readable dated rows, outcome labels, obvious incomplete states and editing |
| Patterns | Restrained charts with denominators, missing-data context, and neutral labels |
| App utilities | Backup, appearance, and installation checks outside the primary night actions |

Candidate navigation: Tonight, History, More. Keep review/record work reachable
from Tonight and History; place the current development-oriented Check screen in
More. Final information architecture is still a proposal.

Show confirmation beside the last event, with Undo available. Do not rely on a
haptic signal alone. Missing, unconfirmed, dry, and wet records need distinct labels.
Avoid a timed detail panel that disappears while someone is actively reading or
editing; settle dismissal behaviour during interaction design.

## Decisions to resolve with the user

| Decision | Recommendation | Status |
| --- | --- | --- |
| Overall personality | Quiet bedside + Gentle companion | Selected by user |
| Appearance scope | Focus on dark nighttime; daytime appearance undecided | Nighttime focus selected by user |
| Illustration level | Functional line icons + quiet bedtime illustration | Illustration selected; execution under review |
| App identity | Keep PeeLog for now; explore a refined icon | Pending discussion |
| Emotional treatment | Neutral wet/dry copy, no confetti | Proposed |
| Navigation | Tonight / History / More | Proposed; validate in screen studies |

## Tensions to reconcile with the original scope

`docs/DESIGN.md` remains the existing product specification. These suggested
revisions need to be agreed and reconciled before implementation:

- Its celebratory dry-night button conflicts with the otherwise non-gamified tone.
- Its “fills in the whole card” wording should not imply guessed morning data.
- It promises three screens/tabs but does not settle the final third destination;
  the current Check tab is an M0 installation aid.
- Its auto-dismiss timer needs an accessible, non-disruptive interaction treatment.

## How the direction will be validated

After the key preferences are agreed, create representative Tonight, morning,
and History studies with realistic sample data. Include a saved event, incomplete
night, and longer labels. Refine exact colour, typography, and icon treatment there.

Check essential text contrast (target 4.5:1 for normal text), meaningful control
and state contrast, large text, keyboard focus, colour-independent meaning, and
reduced motion. Verify real thumb reach and legibility on the intended phone at
low brightness. Exact values and dark-room comfort are not yet validated.

Direction is ready for detailed design once personality, theme scope, emotional
tone, asset style, and representative screen treatment are agreed. Approval of
this direction does not mean the logging implementation is complete.
