"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./rhythm.js");

// ---------------------------------------------------------------------------
// step geometry
// ---------------------------------------------------------------------------
test("steps = beatsPerBar * 4", () => {
  assert.equal(R.steps(4), 16);
  assert.equal(R.steps(3), 12);
  assert.equal(R.steps(6), 24);
  assert.equal(R.steps(2), 8);
});

test("subOf / beatOf decompose a step", () => {
  // beat 1: steps 0..3 -> subs 0,1,2,3
  assert.deepEqual([0, 1, 2, 3].map(R.subOf), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map(R.beatOf), [0, 0, 0, 0]);
  // beat 3 (step 8) is sub 0 of beat index 2
  assert.equal(R.subOf(8), 0);
  assert.equal(R.beatOf(8), 2);
  // mid-beat
  assert.equal(R.subOf(10), 2); // the "&" of beat 3
  assert.equal(R.beatOf(10), 2);
});

test("isBeat / isDownbeat", () => {
  assert.equal(R.isBeat(0), true);
  assert.equal(R.isBeat(4), true);
  assert.equal(R.isBeat(8), true);
  assert.equal(R.isBeat(1), false);
  assert.equal(R.isBeat(2), false);
  assert.equal(R.isBeat(3), false);
  assert.equal(R.isDownbeat(0), true);
  assert.equal(R.isDownbeat(4), false); // a beat, but not THE downbeat
});

// ---------------------------------------------------------------------------
// timing
// ---------------------------------------------------------------------------
test("secondsPer16th matches BPM math", () => {
  // 60 BPM -> quarter = 1s -> 16th = 0.25s
  assert.equal(R.secondsPer16th(60), 0.25);
  // 120 BPM -> quarter = 0.5s -> 16th = 0.125s
  assert.equal(R.secondsPer16th(120), 0.125);
  // 70 BPM (the default)
  assert.ok(Math.abs(R.secondsPer16th(70) - 0.2142857) < 1e-6);
});

// ---------------------------------------------------------------------------
// names & labels
// ---------------------------------------------------------------------------
test("stepName speaks human counting", () => {
  assert.equal(R.stepName(0), "beat 1");
  assert.equal(R.stepName(1), "the 'e' of 1");
  assert.equal(R.stepName(2), "the '&' of 1");
  assert.equal(R.stepName(3), "the 'a' of 1");
  assert.equal(R.stepName(4), "beat 2");
  assert.equal(R.stepName(10), "the '&' of 3");
  assert.equal(R.stepName(15), "the 'a' of 4");
});

test("cellLabels gives big + small label per cell", () => {
  assert.deepEqual(R.cellLabels(0), { main: "1", sub: "beat" });
  assert.deepEqual(R.cellLabels(1), { main: "e", sub: "ee" });
  assert.deepEqual(R.cellLabels(2), { main: "&", sub: "and" });
  assert.deepEqual(R.cellLabels(3), { main: "a", sub: "uh" });
  assert.deepEqual(R.cellLabels(4), { main: "2", sub: "beat" });
  assert.deepEqual(R.cellLabels(11), { main: "a", sub: "uh" });
});

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------
test("presets select the right steps in 4/4", () => {
  assert.deepEqual(R.presetSteps("clear", 4), []);
  assert.deepEqual(R.presetSteps("unknown-name", 4), []);
  assert.deepEqual(R.presetSteps("downbeats", 4), [0, 4, 8, 12]);
  assert.deepEqual(R.presetSteps("e", 4), [1, 5, 9, 13]);
  assert.deepEqual(R.presetSteps("and", 4), [2, 6, 10, 14]);
  assert.deepEqual(R.presetSteps("a", 4), [3, 7, 11, 15]);
  assert.deepEqual(R.presetSteps("offbeats", 4), [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]);
  assert.deepEqual(R.presetSteps("gallop", 4), [0, 3, 4, 7, 8, 11, 12, 15]);
});

test("presets scale with meter", () => {
  assert.deepEqual(R.presetSteps("downbeats", 3), [0, 4, 8]);
  assert.deepEqual(R.presetSteps("downbeats", 6), [0, 4, 8, 12, 16, 20]);
  // offbeats in 2/4 = 6 of the 8 steps
  assert.equal(R.presetSteps("offbeats", 2).length, 6);
});

// ---------------------------------------------------------------------------
// scheduler decisions — the core of the app
// ---------------------------------------------------------------------------
test("eventsForStep: downbeat with everything on", () => {
  assert.deepEqual(
    R.eventsForStep(0, { mode: "explore", targets: [0] }),
    { beatClick: "down", subTick: false, bell: true }
  );
});

test("eventsForStep: a non-downbeat beat clicks 'mid'", () => {
  const ev = R.eventsForStep(4, { mode: "explore", targets: [] });
  assert.equal(ev.beatClick, "mid");
  assert.equal(ev.subTick, false);
  assert.equal(ev.bell, false);
});

test("eventsForStep: off-16th gets a subTick, no beat click", () => {
  const ev = R.eventsForStep(2, { mode: "explore", targets: [] });
  assert.equal(ev.beatClick, null);
  assert.equal(ev.subTick, true);
});

test("eventsForStep: toggles respect playPulse / playSubs", () => {
  const noPulse = R.eventsForStep(0, { playPulse: false, targets: [] });
  assert.equal(noPulse.beatClick, null);

  const noSubs = R.eventsForStep(2, { playSubs: false, targets: [] });
  assert.equal(noSubs.subTick, false);
});

test("eventsForStep: explore bell fires only on target steps (Set or array)", () => {
  assert.equal(R.eventsForStep(6, { mode: "explore", targets: [6] }).bell, true);
  assert.equal(R.eventsForStep(6, { mode: "explore", targets: new Set([6]) }).bell, true);
  assert.equal(R.eventsForStep(7, { mode: "explore", targets: [6] }).bell, false);
});

test("eventsForStep: ear/quiz bell follows quizTargets, ignores explore targets", () => {
  // In a phrase mode the bell rings every step in quizTargets, even if the
  // explore targets set still has stuff in it.
  const opts = { mode: "ear", quizTargets: [3, 9], targets: [1, 2] };
  assert.equal(R.eventsForStep(3, opts).bell, true);
  assert.equal(R.eventsForStep(9, opts).bell, true);
  assert.equal(R.eventsForStep(1, opts).bell, false);
  // read mode passes no quizTargets -> no bells (user performs it)
  assert.equal(R.eventsForStep(0, { mode: "read", quizTargets: [] }).bell, false);
});

test("eventsForStep: count-in plays beats only, never bell/ticks", () => {
  assert.deepEqual(
    R.eventsForStep(0, { isCountIn: true, mode: "explore", targets: [0] }),
    { beatClick: "down", subTick: false, bell: false }
  );
  assert.deepEqual(
    R.eventsForStep(4, { isCountIn: true, targets: [4] }),
    { beatClick: "mid", subTick: false, bell: false }
  );
  // off-16th during count-in is silent
  assert.deepEqual(
    R.eventsForStep(2, { isCountIn: true }),
    { beatClick: null, subTick: false, bell: false }
  );
});

// ---------------------------------------------------------------------------
// count-in index math
// ---------------------------------------------------------------------------
test("countInStep walks 0..n-1 as remaining counts down", () => {
  const n = 16;
  const seen = [];
  for (let remaining = n; remaining >= 1; remaining--) {
    seen.push(R.countInStep(remaining, n));
  }
  // remaining n..1 should map to steps 0,1,2,...,15
  assert.deepEqual(seen, Array.from({ length: n }, (_, i) => i));
});

// ---------------------------------------------------------------------------
// playhead suppression (the "quiz visual is too helpful" fix)
// ---------------------------------------------------------------------------
test("playhead hidden in ear mode unless opted in (answering no longer reveals it)", () => {
  // ear, not opted in -> suppressed, regardless of answer state
  assert.equal(R.shouldSuppressPlayhead("ear", false, false), true);
  assert.equal(R.shouldSuppressPlayhead("ear", false, true), true);
  // opted in -> shown
  assert.equal(R.shouldSuppressPlayhead("ear", true, false), false);
  // explore / read -> never suppressed
  assert.equal(R.shouldSuppressPlayhead("explore", false, false), false);
  assert.equal(R.shouldSuppressPlayhead("read", false, false), false);
});

// ---------------------------------------------------------------------------
// quiz scoring + feedback
// ---------------------------------------------------------------------------
test("quizResult marks correct and wrong with readable messages", () => {
  const right = R.quizResult(9, 9);
  assert.equal(right.correct, true);
  assert.match(right.message, /Yes/);
  assert.match(right.message, /the 'e' of 3/);

  const wrong = R.quizResult(8, 9);
  assert.equal(wrong.correct, false);
  assert.match(wrong.message, /That was the 'e' of 3/);
  assert.match(wrong.message, /not beat 3/);
});

// ---------------------------------------------------------------------------
// difficulty & phrase generation
// ---------------------------------------------------------------------------
test("difficultyNoteCount maps levels (all on the 16th grid)", () => {
  assert.equal(R.difficultyNoteCount("easy"), 2);
  assert.equal(R.difficultyNoteCount("medium"), 3);
  assert.equal(R.difficultyNoteCount("hard"), 4);
  assert.equal(R.difficultyNoteCount("bogus"), 3); // defaults to medium
});

test("randomPattern returns the right count of distinct, sorted, in-range steps", () => {
  // deterministic rng cycling through fixed values
  const seq = [0.1, 0.9, 0.3, 0.5, 0.7, 0.2];
  let i = 0;
  const rng = () => seq[i++ % seq.length];
  const p = R.randomPattern(3, 16, rng);
  assert.equal(p.length, 3);
  assert.deepEqual(p, [...p].sort((a, b) => a - b)); // sorted
  assert.equal(new Set(p).size, 3);                  // distinct
  assert.ok(p.every(s => s >= 0 && s < 16));         // in range
});

test("randomPattern clamps noteCount to the bar size", () => {
  const p = R.randomPattern(99, 8, () => 0);
  assert.equal(p.length, 8);
  assert.deepEqual(p, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("barDurations merges empty slots into the largest aligned rests", () => {
  const seq = (pattern, beats) =>
    R.barDurations(pattern, beats).map(x => (x.isRest ? x.dur : "n" + x.step));

  // empty beat -> one quarter rest, not four 16th rests
  assert.deepEqual(seq([], 1), ["qr"]);
  // empty 4/4 -> four quarter rests
  assert.deepEqual(seq([], 4), ["qr", "qr", "qr", "qr"]);
  // onset on the beat, rest of beat empty -> note + 16th rest + 8th rest (binary, aligned)
  assert.deepEqual(seq([0], 1), ["n0", "16r", "8r"]);
  // onsets on "1" and "&" -> note, 16th rest, note, 16th rest
  assert.deepEqual(seq([0, 2], 1), ["n0", "16r", "n2", "16r"]);
  // full beat of 16ths -> four notes, no rests
  assert.deepEqual(seq([0, 1, 2, 3], 1), ["n0", "n1", "n2", "n3"]);
  // second beat starts on its downbeat -> first beat collapses to one quarter rest
  assert.deepEqual(seq([4], 2), ["qr", "n4", "16r", "8r"]);
  // a single "e" -> 16th rest, note, 8th rest (rest after merges)
  assert.deepEqual(seq([1], 1), ["16r", "n1", "8r"]);
});

// ---------------------------------------------------------------------------
// points
// ---------------------------------------------------------------------------
test("basePoints scale with note count", () => {
  assert.equal(R.basePoints(2), 100);
  assert.equal(R.basePoints(3), 150);
  assert.equal(R.basePoints(4), 200);
});

test("pointsAvailable halves per replay (first listen free)", () => {
  assert.equal(R.pointsAvailable(150, 0), 150);
  assert.equal(R.pointsAvailable(150, 1), 75);
  assert.equal(R.pointsAvailable(150, 2), 37); // floor(37.5)
  assert.equal(R.pointsAvailable(150, 10), 0); // never negative
});

test("percent rounds part/whole, 0 when nothing possible", () => {
  assert.equal(R.percent(50, 150), 33);
  assert.equal(R.percent(150, 150), 100);
  assert.equal(R.percent(0, 150), 0);
  assert.equal(R.percent(5, 0), 0);   // no division by zero
});

test("pushRecent prepends newest-first and caps the list", () => {
  let h = [];
  for (let i = 1; i <= 12; i++) h = R.pushRecent(h, i, 10);
  assert.equal(h.length, 10);
  assert.equal(h[0], 12);  // newest first
  assert.equal(h[9], 3);   // oldest kept (1 and 2 dropped)
});

// ---------------------------------------------------------------------------
// multi-note selection grading
// ---------------------------------------------------------------------------
test("gradeSelection scores hits, misses, false positives", () => {
  const target = [2, 6, 10];
  // perfect
  let g = R.gradeSelection([2, 6, 10], target);
  assert.deepEqual([g.hits, g.missed, g.falsePos, g.correct, g.fraction], [3, 0, 0, true, 1]);
  // one missing
  g = R.gradeSelection([2, 6], target);
  assert.equal(g.hits, 2); assert.equal(g.missed, 1); assert.equal(g.correct, false);
  assert.ok(Math.abs(g.fraction - 2 / 3) < 1e-9);
  // a false positive drags the fraction down
  g = R.gradeSelection([2, 6, 10, 7], target);
  assert.equal(g.hits, 3); assert.equal(g.falsePos, 1); assert.equal(g.correct, false);
  assert.ok(Math.abs(g.fraction - 2 / 3) < 1e-9); // (3-1)/3
  // all wrong -> clamped at 0
  g = R.gradeSelection([1, 5], target);
  assert.equal(g.fraction, 0);
});

// ---------------------------------------------------------------------------
// timing (read mode)
// ---------------------------------------------------------------------------
test("classifyTiming buckets early / on-time / late", () => {
  assert.deepEqual(R.classifyTiming(0), { grade: "perfect", dir: "on" });
  assert.deepEqual(R.classifyTiming(-40), { grade: "perfect", dir: "early" });
  assert.deepEqual(R.classifyTiming(90), { grade: "good", dir: "late" });
  assert.deepEqual(R.classifyTiming(-90), { grade: "good", dir: "early" });
  assert.equal(R.classifyTiming(300).grade, "miss");
});

test("gradePerformance matches taps to notes greedily and scores", () => {
  const notes = [0, 250, 500];
  // first dead on, second 90ms late (good), third no tap (miss)
  const taps = [5, 340];
  const r = R.gradePerformance(notes, taps);
  assert.equal(r.perNote[0].grade, "perfect");
  assert.equal(r.perNote[1].grade, "good");
  assert.equal(r.perNote[1].dir, "late");
  assert.equal(r.perNote[2].grade, "miss");
  assert.equal(r.perNote[2].deltaMs, null);
  // score = 1 + 0.5 + 0 = 1.5 over 3 notes
  assert.ok(Math.abs(r.fraction - 0.5) < 1e-9);
});

test("gradePerformance penalizes extra taps and reports them", () => {
  const notes = [0];
  const taps = [2, 1000, 2000]; // one good hit + two stray taps
  const r = R.gradePerformance(notes, taps);
  assert.equal(r.falsePos, 2);
  assert.deepEqual(r.extraTaps, [1000, 2000]); // the unmatched taps, for plotting
  assert.equal(r.perNote[0].grade, "perfect");
  assert.ok(Math.abs(r.fraction - 0.5) < 1e-9); // (1 - 0.25*2)/1
});

test("timingWindows gives looser/tighter perfect+good windows", () => {
  assert.deepEqual(R.timingWindows("loose"), { perfect: 90, good: 200 });
  assert.deepEqual(R.timingWindows("normal"), { perfect: 55, good: 130 });
  assert.deepEqual(R.timingWindows("strict"), { perfect: 30, good: 80 });
  assert.deepEqual(R.timingWindows("???"), R.timingWindows("normal")); // default
});
