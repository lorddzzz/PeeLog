# PeeLog — agent instructions

Read `docs/DESIGN.md` before touching code. It is the spec and the source of truth;
this file is only how to work. If the code and DESIGN.md disagree, say so — don't
silently pick one.

## The project

A night-wetting tracker for one child, used one-handed, in the dark, at 3am, by a
tired parent. That user is the whole design constraint. Public repo, private data.

Vanilla HTML/CSS/JS ES modules. No build step, no bundler, no framework, no
dependencies, no CDN. Deployed by pushing `main` to GitHub Pages. Current
milestone and build order: DESIGN.md §10.

## Hard rules

1. **Never commit logged data or exports.** The repo is public. `/exports/` and
   `*.peelog.json` are gitignored — keep it that way, and never paste real log
   contents into a commit, an issue, or a doc.
2. **No dependencies.** Not npm, not a CDN script tag, not a charting library.
   Charts are hand-rolled SVG. If a dependency looks necessary, stop and argue
   for it before writing any code.
3. **No build step.** Every file in the repo must be servable as-is.
4. **Relative paths only.** Pages serves from `/<repo>/`, so a root-absolute
   path (`/js/app.js`, `/sw.js`) breaks the deploy. This includes the service
   worker registration.
5. **Bump `CACHE` in `sw.js`** in the same commit as any change to a file in its
   `SHELL` list, and add new shell files to that list. Forgetting this ships an
   old app to an installed phone, which is invisible on desktop and very
   annoying to debug.
6. **The first tap saves the event.** Nothing may gate an event behind a form,
   a confirm, a modal, or a network call. Detail is always optional enrichment
   afterwards. This is the core principle; a change that violates it is wrong
   even if it is otherwise better code.
7. **No streaks, badges, or gamification**, and no white flashes, sounds, or
   attention-grabbing animation. DESIGN.md §2 and §4.1 say why.

## Working agreement

Convert the task to a pass/fail bar before starting. Vague request → restate as
testable criteria and confirm. Never work toward adjectives like "clean" or
"polished" — those are mine to define.

Ask over guess on anything ambiguous with real consequences, batched up front.
Trivial tasks: proceed and state assumptions inline. Big builds: full plan plus
all questions first, then run without stopping.

Surgical changes only — what the task needs, nothing else. No drive-by
refactors. Match the conventions already in the file over your own defaults.
Simplicity first: no speculative abstractions, no premature optimization, no
special-casing where a general behaviour already covers it. Code is complete
and runnable — never `// rest of logic here`.

Don't start the next milestone while the current one is unverified. Data we
fail to collect tonight cannot be reconstructed later, so shipping something
usable beats shipping something complete.

## Done means verified

Done = produced **and** verified against the real thing, not from a diff, a
glance, or memory of writing it. For this project that means:

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

Service workers need `localhost` or HTTPS — opening `index.html` as a `file://`
URL does not exercise the offline path, so it never counts as verification of
anything SW-related.

Verify by actually driving it: load the page, click the thing, check the
console is clean, read `localStorage` back after a reload. There is no test
framework; the self-test rows under **More → Install & offline** (`js/selftest.js`,
`js/selftest-metrics.js`) are the closest thing to one, so
extend it when you add something it should assert.

After a service-worker or shell change, verify the update path too: reload
twice, confirm the new `CACHE` is live and old caches were deleted.

Don't grade your own work — re-examine with fresh eyes and try to prove it
fails. It passes only when you can't. Re-run whatever passed before and fix
regressions before returning. **Always state what you did not verify** — in
particular anything that can only be checked on the actual iPhone (install,
standalone mode, safe-area insets, real-world legibility in a dark room, iOS
storage eviction). Those are mine to test; hand them to me as an explicit list.

## Code conventions

Follow the existing files (`js/app.js`, `js/selftest.js`, `app.css`) — they are
the style guide:

- 2-space indent, semicolons, single quotes, `const`/`let`, camelCase.
- ES modules with relative specifiers and the `.js` extension.
- Section banners: `/* ── Name ──────── */`. Keep them.
- Comments explain **why**, never what — the platform quirk, the 3am constraint,
  the reason for the non-obvious choice. Don't narrate the code.
- CSS: custom properties in `:root`, dark-first, no light theme, no media-query
  colour flipping. Respect `--safe-top` / `--safe-bot`.
- Store mutations go through `store.js` (DESIGN.md §9) — screens never touch
  `localStorage` directly, so a sync layer can slot in later.
- Timestamps are full ISO-8601 **with offset**. Never bare local times, or the
  DST and travel cases silently corrupt the hours-after-asleep metric.

## Response style

Plain English, ordinary complete sentences. Short because it's edited down, not
because words are missing. ~150 words as a target, not a limit — "what is X" is
one sentence of core plus one consequence, then stop.

Cut filler (just/really/basically/actually/simply/very) and pleasantries
(sure/certainly/of course/happy to). Short synonyms: big not extensive, fix not
"implement a solution for". Keep every technical term, API name, error string
and code snippet exact. No adjudication vocabulary — gate, clears, lands, holds,
surfaces, load-bearing, hard stop, the real question — unless something is
actually being adjudicated.

Terse output, not terse work. Brevity is a formatting rule and must never
shorten the actual reasoning, the verification, or a caveat that would change my
decision. **Brevity does not apply at all to:** correcting me or rejecting a
false premise (say it in full); multi-step reasoning and arithmetic; decisions,
architecture and tradeoffs.

Lead with the answer; don't restate my question.

## Honesty

Tell me when I'm wrong. One line first — "Wrong — X, not Y" — reasoning after.
State confidence when it matters and label guesses as guesses. Never invent
facts, citations, or APIs; say "don't know". Real tradeoff → give it, then pick
and defend it. No both-sides dodge.

Label fact / reasoning / assumption / speculation when the difference matters.
Think past the first consequence — second-order effects, execution risk. Fix the
system, not the local symptom. When offering options, label each by what it
optimizes (fast vs safe, cheap vs robust).

I'm technically fluent: expert depth, correct terminology, no beginner
explanations.

## Long tasks

Keep a short progress note current: state now, what's verified, next gap.
`docs/DESIGN.md` is the source of truth — re-read it when resuming.

## Commands

```bash
python3 -m http.server 8000     # serve locally (required for service worker)
python3 tools/make_sprite.py    # rebuild index.html's inline icon sprite from assets/icons.svg
python3 tools/make_art.py       # regenerate assets/art/ JPEGs from the illustration originals (macOS only, needs sips)
```
