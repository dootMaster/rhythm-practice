/*
 * rhythm.js — pure logic for the 16th Note Feel Trainer.
 *
 * No DOM, no Web Audio, no timers. Everything here is a pure function so it can
 * be unit-tested with `node --test`. index.html loads this as a plain <script>
 * (exposing `window.Rhythm`); the test suite imports it via require().
 *
 * Conventions:
 *   - A "step" is a 16th-note index within a bar, 0-based. Bar of N beats has
 *     N*4 steps (steps 0..N*4-1).
 *   - "sub" is the position within a beat: 0 = the beat ("1"), 1 = "e",
 *     2 = "&", 3 = "a".
 */
(function (global) {
  "use strict";

  // Labels shown on each cell. Index = sub (0..3).
  var SUB_LABELS = ["", "e", "&", "a"];        // the big label (beat number replaces index 0)
  var SUB_SUBLABELS = ["beat", "ee", "and", "uh"]; // the small spoken-syllable label

  function steps(beatsPerBar) {
    return beatsPerBar * 4;
  }

  // Duration of one 16th note in seconds.
  function secondsPer16th(bpm) {
    return (60 / bpm) / 4;
  }

  function subOf(step) {
    return ((step % 4) + 4) % 4; // tolerate negatives
  }

  function beatOf(step) {
    return Math.floor(step / 4); // 0-based beat index
  }

  function isBeat(step) {
    return subOf(step) === 0;
  }

  function isDownbeat(step) {
    return step === 0;
  }

  // Human-readable name of a step, e.g. "beat 1", "the 'e' of 2".
  function stepName(step) {
    var sub = subOf(step);
    var beat = beatOf(step) + 1; // 1-based for humans
    if (sub === 0) return "beat " + beat;
    return ["", "the 'e' of " + beat, "the '&' of " + beat, "the 'a' of " + beat][sub];
  }

  // The two label strings for a cell (big + small).
  function cellLabels(step) {
    var sub = subOf(step);
    if (sub === 0) {
      return { main: String(beatOf(step) + 1), sub: SUB_SUBLABELS[0] };
    }
    return { main: SUB_LABELS[sub], sub: SUB_SUBLABELS[sub] };
  }

  // Steps selected by a named preset. Returns a sorted array of step indices.
  function presetSteps(name, beatsPerBar) {
    var out = [];
    var n = steps(beatsPerBar);
    for (var step = 0; step < n; step++) {
      var sub = subOf(step);
      var keep =
        (name === "downbeats" && sub === 0) ||
        (name === "e" && sub === 1) ||
        (name === "and" && sub === 2) ||
        (name === "a" && sub === 3) ||
        (name === "offbeats" && sub !== 0) ||
        (name === "gallop" && (sub === 0 || sub === 3));
      if (keep) out.push(step);
    }
    return out; // "clear" and unknown names -> []
  }

  // membership helper that accepts a Set or an array
  function has(targets, step) {
    if (!targets) return false;
    if (typeof targets.has === "function") return targets.has(step);
    return targets.indexOf(step) !== -1;
  }

  /*
   * The heart of the scheduler: given a step and the current settings, decide
   * which sounds fire. Returns a plain object the audio layer turns into noise:
   *   { beatClick: "down" | "mid" | null, subTick: boolean, bell: boolean }
   *
   * opts:
   *   playPulse  - play the beat clicks (default true)
   *   playSubs   - play quiet ticks on the off-16ths (default true)
   *   mode       - "explore" | "quiz"
   *   targets    - Set/array of target steps (explore mode)
   *   quizTarget - the single target step (quiz mode), or null
   *   isCountIn  - true during the count-in bar (beats only, no bell/ticks)
   */
  function eventsForStep(step, opts) {
    opts = opts || {};
    var beat = isBeat(step);
    var down = isDownbeat(step);
    var beatClick = beat ? (down ? "down" : "mid") : null;

    if (opts.isCountIn) {
      return { beatClick: beatClick, subTick: false, bell: false };
    }

    var playPulse = opts.playPulse !== false;
    var playSubs = opts.playSubs !== false;
    // explore mode rings the user-placed targets; ear/read modes ring the
    // current phrase (quizTargets). read mode passes an empty set (no bells).
    var bell =
      opts.mode === "explore"
        ? has(opts.targets, step)
        : has(opts.quizTargets, step);

    return {
      beatClick: playPulse && beat ? beatClick : null,
      subTick: !!(playSubs && !beat),
      bell: !!bell,
    };
  }

  // During a count-in we step a separate counter that goes from `total` down to
  // 1; this maps it back to a 0-based step index so we click the right beats.
  function countInStep(remaining, total) {
    return (total - (remaining % total)) % total;
  }

  // Should the moving playhead be hidden? In ear mode it would reveal the
  // answer (it lights the cell exactly when the bell sounds), so it stays
  // hidden unless the user opts in. We don't "reveal" it after answering —
  // the colored grid is the feedback, and a lingering playhead highlight looks
  // just like the green "correct" marker. quizAnswered is kept for signature
  // stability but no longer changes the result.
  function shouldSuppressPlayhead(mode, showQuizPlayhead, quizAnswered) {
    return mode === "ear" && !showQuizPlayhead;
  }

  // Evaluate a single-note quiz answer. Returns { correct, message }.
  function quizResult(clickedStep, quizTarget) {
    var correct = clickedStep === quizTarget;
    var message = correct
      ? "✓ Yes — " + stepName(clickedStep)
      : "✗ That was " + stepName(quizTarget) + ", not " + stepName(clickedStep);
    return { correct: correct, message: message };
  }

  // ----- Difficulty & phrase generation -----

  // Each level is an inclusive note-count band (counts are clamped to the bar
  // size in randomPattern). "one" and "easy" are deliberately distinct.
  var DIFFICULTY = {
    one:    { min: 1, max: 1 },
    easy:   { min: 1, max: 4 },
    medium: { min: 4, max: 8 },
    hard:   { min: 8, max: 16 },
    random: { min: 1, max: 16 },
  };
  function difficultyRange(level) { return DIFFICULTY[level] || DIFFICULTY.easy; }

  // Pick a note count within the level's range, biased toward the sparse (low)
  // end: taking min of two uniforms skews low, so sparse "feel"-trainable
  // patterns are common and near-full rolls (e.g. 15-16 notes) are rare but
  // still possible. rng for tests.
  function noteCountFor(level, rng) {
    rng = rng || Math.random;
    var r = difficultyRange(level);
    var u = Math.min(rng(), rng());
    return r.min + Math.floor(u * (r.max - r.min + 1));
  }

  // Random phrase: `noteCount` distinct 16th steps within a bar of `totalSteps`,
  // returned sorted. `rng` defaults to Math.random; pass a fixed one in tests.
  function randomPattern(noteCount, totalSteps, rng) {
    rng = rng || Math.random;
    noteCount = Math.max(1, Math.min(noteCount, totalSteps));
    var pool = [];
    for (var i = 0; i < totalSteps; i++) pool.push(i);
    // partial Fisher–Yates
    for (var k = 0; k < noteCount; k++) {
      var j = k + Math.floor(rng() * (totalSteps - k));
      var tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, noteCount).sort(function (a, b) { return a - b; });
  }

  // Standard note values measured in 16th-note slots, longest first, with the
  // VexFlow base duration + dot count.
  var VALUES = [
    { n: 16, dur: "w", dots: 0 }, { n: 12, dur: "h", dots: 1 }, { n: 8, dur: "h", dots: 0 },
    { n: 6, dur: "q", dots: 1 }, { n: 4, dur: "q", dots: 0 }, { n: 3, dur: "8", dots: 1 },
    { n: 2, dur: "8", dots: 0 }, { n: 1, dur: "16", dots: 0 },
  ];
  // May a value of length n.dots start at slot `pos` without crossing a metric
  // boundary stronger than itself? Non-dotted notes align to their own length;
  // dotted notes must start on the next-stronger (2*base) boundary.
  function aligns(pos, v) {
    if (v.dots === 0) return pos % v.n === 0;
    var base = (v.n / 3) * 2;          // 3->2, 6->4, 12->8
    return pos % (2 * base) === 0;
  }
  // Decompose a span [start, start+len) into tied standard note values that
  // respect the metric grid (greedy longest-first).
  function decompose(start, len) {
    var out = [], pos = start, rem = len;
    while (rem > 0) {
      var chosen = null;
      for (var k = 0; k < VALUES.length; k++) {
        var v = VALUES[k];
        if (v.n <= rem && aligns(pos, v)) { chosen = v; break; }
      }
      if (!chosen) chosen = { n: 1, dur: "16", dots: 0 }; // safety net
      out.push({ dur: chosen.dur, dots: chosen.dots });
      pos += chosen.n; rem -= chosen.n;
    }
    return out;
  }

  // Turn a phrase (onset steps) into real notation for one bar: each note lasts
  // until the next onset (or the barline), so note *values* vary (16th, 8th,
  // dotted-8th, quarter, half, whole...) with ties across beats, and rests only
  // appear before the first note. Returns an ordered list of pieces:
  //   { isRest, dur, dots, step (onset step on a note's first piece, else null),
  //     tie (true if this piece ties into the next) }
  function barNotes(pattern, beatsPerBar) {
    var total = beatsPerBar * 4;
    var onsets = Array.from(new Set(pattern))
      .filter(function (s) { return s >= 0 && s < total; })
      .sort(function (a, b) { return a - b; });
    var out = [];
    var firstAttack = onsets.length ? onsets[0] : total;
    if (firstAttack > 0) {
      decompose(0, firstAttack).forEach(function (p) {
        out.push({ isRest: true, dur: p.dur, dots: p.dots, step: null, tie: false });
      });
    }
    for (var i = 0; i < onsets.length; i++) {
      var start = onsets[i];
      var end = i + 1 < onsets.length ? onsets[i + 1] : total;
      var pieces = decompose(start, end - start);
      pieces.forEach(function (p, idx) {
        out.push({
          isRest: false, dur: p.dur, dots: p.dots,
          step: idx === 0 ? start : null,
          tie: idx < pieces.length - 1,   // tie pieces of the same held note
        });
      });
    }
    return out;
  }

  // ----- Points -----

  function basePoints(noteCount) {
    return noteCount * 50; // easy 100 / medium 150 / hard 200
  }

  // Points still on the table after `replays` listens (first listen is free).
  // Each replay halves the pot.
  function pointsAvailable(base, replays) {
    return Math.max(0, Math.floor(base * Math.pow(0.5, Math.max(0, replays))));
  }

  // Rounded percentage of part/whole; 0 when there's nothing possible yet.
  function percent(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
  }

  // Prepend an entry and keep at most `max`, newest first (for the history log).
  function pushRecent(list, entry, max) {
    return [entry].concat(list || []).slice(0, max);
  }

  function toSet(x) {
    if (!x) return new Set();
    return typeof x.has === "function" ? x : new Set(x);
  }

  // Grade a multi-note ear answer: which selected cells were right/wrong.
  function gradeSelection(selected, target) {
    var sel = toSet(selected), tar = toSet(target);
    var hits = 0, falsePos = 0;
    sel.forEach(function (s) { if (tar.has(s)) hits++; else falsePos++; });
    var missed = tar.size - hits;
    var correct = hits === tar.size && falsePos === 0;
    var fraction = tar.size ? Math.max(0, (hits - falsePos) / tar.size) : 0;
    return { hits: hits, falsePos: falsePos, missed: missed, correct: correct, fraction: Math.min(1, fraction) };
  }

  // ----- Timing (read mode) -----

  // Rhythmic tolerance: how tight the perfect/good windows are (ms).
  var TIMING = {
    loose:  { perfect: 90, good: 200 },
    normal: { perfect: 55, good: 130 },
    strict: { perfect: 30, good: 80 },
  };
  function timingWindows(level) { return TIMING[level] || TIMING.normal; }

  // Classify one tap's timing error (ms). delta < 0 = early, > 0 = late.
  function classifyTiming(deltaMs, windows) {
    windows = windows || { perfect: 50, good: 120 };
    var a = Math.abs(deltaMs);
    var dir = deltaMs < 0 ? "early" : deltaMs > 0 ? "late" : "on";
    if (a <= windows.perfect) return { grade: "perfect", dir: a === 0 ? "on" : dir };
    if (a <= windows.good) return { grade: "good", dir: dir };
    return { grade: "miss", dir: dir };
  }

  // Greedily match taps to notated note times (each tap used once) and grade.
  // Returns { perNote: [{deltaMs, grade, dir}], fraction (0..1), falsePos }.
  function gradePerformance(noteTimes, tapTimes, windows) {
    windows = windows || { perfect: 50, good: 120 };
    var used = [];
    var perNote = noteTimes.map(function (nt) {
      var bestIdx = -1, bestAbs = Infinity;
      for (var i = 0; i < tapTimes.length; i++) {
        if (used[i]) continue;
        var d = Math.abs(tapTimes[i] - nt);
        if (d < bestAbs) { bestAbs = d; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestAbs <= windows.good) {
        used[bestIdx] = true;
        var delta = tapTimes[bestIdx] - nt;
        var c = classifyTiming(delta, windows);
        return { deltaMs: delta, grade: c.grade, dir: c.dir };
      }
      return { deltaMs: null, grade: "miss", dir: "on" };
    });
    var extraTaps = [];
    for (var k = 0; k < tapTimes.length; k++) if (!used[k]) extraTaps.push(tapTimes[k]);
    var falsePos = extraTaps.length;
    var score = perNote.reduce(function (s, p) {
      return s + (p.grade === "perfect" ? 1 : p.grade === "good" ? 0.5 : 0);
    }, 0);
    var fraction = noteTimes.length
      ? Math.max(0, Math.min(1, (score - 0.25 * falsePos) / noteTimes.length))
      : 0;
    return { perNote: perNote, fraction: fraction, falsePos: falsePos, extraTaps: extraTaps };
  }

  var Rhythm = {
    SUB_LABELS: SUB_LABELS,
    SUB_SUBLABELS: SUB_SUBLABELS,
    steps: steps,
    secondsPer16th: secondsPer16th,
    subOf: subOf,
    beatOf: beatOf,
    isBeat: isBeat,
    isDownbeat: isDownbeat,
    stepName: stepName,
    cellLabels: cellLabels,
    presetSteps: presetSteps,
    eventsForStep: eventsForStep,
    countInStep: countInStep,
    shouldSuppressPlayhead: shouldSuppressPlayhead,
    quizResult: quizResult,
    difficultyRange: difficultyRange,
    noteCountFor: noteCountFor,
    randomPattern: randomPattern,
    barNotes: barNotes,
    basePoints: basePoints,
    pointsAvailable: pointsAvailable,
    percent: percent,
    pushRecent: pushRecent,
    gradeSelection: gradeSelection,
    classifyTiming: classifyTiming,
    gradePerformance: gradePerformance,
    timingWindows: timingWindows,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Rhythm; // Node / tests
  }
  global.Rhythm = Rhythm; // browser
})(typeof globalThis !== "undefined" ? globalThis : this);
