# Diff Two Texts Faster

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/tpl11295/makefun-diff-speed-01/rank.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/tpl11295/makefun-diff-speed-01/reward.svg)](https://make.fun/c/diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0: `solve.js` returns
exactly the same patch for every input, about 3x faster than the house
baseline on the practice set.

## How it is faster (same answer, better engineering)

- Lines are interned to integer ids (one `Map` for both texts), so the
  search compares ints instead of strings.
- Myers's greedy search runs on `Int32Array` V-snapshots with no per-step
  object allocation (the baseline allocates a path object per step).
- The winning path is recovered by backtracking through the snapshots with
  the same tie-break the forward search used (deletion wins ties); snakes
  are recovered from the V arrays, never by walking back while lines are
  equal, which misattributes repeated lines.
- The patch renderer is a line-for-line transliteration of the reference.

## Entry

`solve.js` (ES module, `run(input)`), `main.ts` (the kit's driver, kept as
shipped: reads `/input/cases.json`, writes `/output/answers.json`).

## Verification

- Practice set: all 4 cases byte-identical to `practice/reference/expected.json`.
- 24 extra cases drawn from the kit's own generator (`diff-pairs.mjs`): all identical.
- 3,000 random small cases + 58,081 exhaustive pairs over a 3-letter alphabet: all identical.
