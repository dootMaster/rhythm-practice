# 16th Note Feel Trainer

A browser app for internalizing where individual 16th notes (`1 e & a`) sit inside a beat.
Open `index.html` directly — no build, no server.

## Files

| File                | Role                                                              |
|---------------------|-------------------------------------------------------------------|
| `index.html`        | UI + Web Audio scheduler + DOM wiring. Loads VexFlow + `rhythm.js`.|
| `rhythm.js`         | **Pure logic**, no DOM/audio/timers. Single source of truth.      |
| `rhythm.test.js`    | Unit tests for `rhythm.js` (Node built-in runner, zero deps).     |
| `vendor/vexflow.js` | Vendored VexFlow 4 (UMD, `window.Vex`) for read-mode notation.    |

## Modes

- **Explore** — place target bells on a 16th grid; continuous loop; feel where they sit.
- **Ear** — a phrase of N notes plays **once**; click every 16th you heard, then Submit. Replays cost points (active recall).
- **Read** — a rhythm in standard notation with real note durations: each note lasts until the next onset (so values vary — 16th, 8th, dotted-8th, quarter, half, whole), tied across beats, with rests only before the first note. **New phrase** shows the notation silently; **Perform** counts you in in the meter (1·2·3·4, distinct woodblock), then records your taps for one bar, stops, and grades early / on-time / late. A marker lane under the staff plots each note (gray tick) against your tap (colored dot, offset left = early / right = late; red tick = stray tap). **Tolerance** (Loose / Normal / Strict) sets the perfect/good timing windows. No auto-advance — Perform again (costs points) or New phrase. Best attempt per phrase is banked.

A hidden **History** popover (📊, bottom bar) logs your last 10 submissions — mode, note count, score %, and time taken — persisted in localStorage.

Difficulty sets a per-phrase note-count range, all on the full 16th grid: One (1), Easy (1–4), Medium (4–8), Hard (8–16), Random (1–16). The count is **biased toward the sparse end** of each band (min of two draws), so trainable sparse patterns dominate and near-full "rolls" are rare but possible. Drives Ear + Read. Scoring is an **accuracy %** (credit earned ÷ credit possible, weighted by note count). A phrase's credit ceiling halves per replay (Worth 100% → 50% → 25%); your answer's correctness scales it. Read banks the best attempt per phrase.

## Run the tests

```sh
npm test        # or: node --test
```

## Adding features without regressions

Put any new *logic* in `rhythm.js` as a pure function and test it in `rhythm.test.js`.
`index.html` should only translate those decisions into sound/DOM. Things already
covered by tests (don't let these silently change):

- step geometry (`steps`, `subOf`, `beatOf`, `isBeat`, `isDownbeat`)
- tempo math (`secondsPer16th`)
- labels & spoken names (`cellLabels`, `stepName`)
- presets (`presetSteps`)
- **what sounds fire per step** (`eventsForStep`) — the core scheduler decision
- count-in indexing (`countInStep`)
- ear-mode playhead suppression (`shouldSuppressPlayhead`)
- single-note quiz feedback (`quizResult`)
- difficulty → note count (`difficultyNoteCount`) and phrase generation (`randomPattern`)
- notation durations (`barNotes`) — real note values + ties via a metric decomposition, not stacked 16ths
- points: `basePoints`, `pointsAvailable` (replay halving)
- multi-note grading (`gradeSelection`)
- read-mode timing (`classifyTiming`, `gradePerformance`, `gradeHolds` press+hold grading w/ tap-only threshold, `timingWindows`)
- latency calibration (`calibrationOffset`) — tap-along to the metronome, median offset subtracted from taps

Examples of features that fit this pattern: swing/shuffle (extend `secondsPer16th`
into a per-step offset fn), accent patterns, triplet mode (generalize the `4`),
new presets, scoring streaks.
