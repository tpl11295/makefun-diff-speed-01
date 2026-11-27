// Fast drop-in for makefun-diff 1.0.0: returns exactly makefun-diff's patch
// for every input, faster. Same rule as vendor/makefun-diff/index.js states:
// tokenize after every "\n" (a last line without one is a line too); longest
// common prefix, then longest common suffix of what is left; between them
// Myers's greedy search, furthest into the old text per diagonal, deletion
// winning ties, no move past either text's end, every equal run followed as
// far as it goes; first path to reach both ends is the script. Patch rendered
// exactly as the reference renders it (header, hunks of context 3, runs at
// most 6 kept lines apart sharing a hunk, "%" after a line with no newline).
//
// Speed comes from engineering, not a different answer: lines are interned
// to integer ids (one Map for both texts, so equal lines share an id), the
// search runs on Int32Array V-snapshots with no per-step allocation, and the
// winning path is recovered by backtracking with the same tie-break the
// forward search used. No randomness, no I/O, no Date: deterministic.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** Tokenize a text into lines (each with its "\n", the last one without when
 *  the text does not end in one), interning each line to an integer id. */
function tokenize(text, intern, outTexts) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const ids = new Int32Array(parts.length);
  let count = 0;
  for (let i = 0; i < last; i++) {
    const line = parts[i] + '\n';
    outTexts.push(line);
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[count++] = id;
  }
  if (parts[last] !== '') {
    const line = parts[last];
    outTexts.push(line);
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[count++] = id;
  }
  return ids.subarray(0, count);
}

/** The edit runs of a into b (middle slices, after prefix/suffix trim):
 *  [{ kind, count }] in order, kinds KEEP/DELETE/INSERT. */
function myersRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m === 0 ? [] : [{ kind: INSERT, count: m }];
  if (m === 0) return [{ kind: DELETE, count: n }];

  // Forward search. Vs[d] is the furthest old-lines-consumed x per diagonal
  // k in [-d, d] step 2, at index k + d; -1 means the diagonal is dead.
  // x is a consumed count (0..n); the reference's oldPos is x - 1.
  const maxD = n + m;
  const Vs = new Array(maxD + 1);
  let foundD = -1;
  let foundK = 0;
  outer: for (let d = 0; d <= maxD; d++) {
    const V = new Int32Array(2 * d + 1).fill(-1);
    Vs[d] = V;
    if (d === 0) {
      let x = 0;
      let y = 0;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      V[0] = x;
      if (x >= n && y >= m) {
        foundD = 0;
        foundK = 0;
        break outer;
      }
      continue;
    }
    const Vp = Vs[d - 1];
    const w = 2 * d - 1; // Vp.length
    for (let k = -d, idx = 0; k <= d; k += 2, idx += 2) {
      // Vp index of diagonal k-1 is idx-2, of k+1 is idx.
      const iDel = idx - 2;
      const xDel = iDel >= 0 ? Vp[iDel] : -1;
      const xIns = idx < w ? Vp[idx] : -1;
      // Reference predicates, in consumed counts:
      // canRemove: oldPos+1 < oldLen  <=>  xDel < n
      // canAdd:    oldPos-k < newLen  <=>  xIns-k <= m
      const canDel = xDel !== -1 && xDel < n;
      const canIns = xIns !== -1 && xIns - k <= m;
      if (!canDel && !canIns) continue;
      // Reference tie-break: deletion when its landing reaches at least
      // as far into the old text as the insertion's.
      const x = canDel && (!canIns || xDel + 1 >= xIns) ? xDel + 1 : xIns;
      let y = x - k;
      let xx = x;
      while (xx < n && y < m && a[xx] === b[y]) {
        xx++;
        y++;
      }
      V[idx] = xx;
      if (xx >= n && y >= m) {
        foundD = d;
        foundK = k;
        break outer;
      }
    }
  }
  if (foundD < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack the winning path from (n, m) at (foundD, foundK), using the
  // same predicates and tie-break the forward search used at each depth.
  // The snake at each depth is recovered from the V arrays, never by
  // walking back while lines are equal: with repeated lines that walk
  // matches the wrong occurrence of the kept line.
  const rev = [];
  let x = n;
  let y = m;
  let d = foundD;
  let k = foundK;
  while (d > 0) {
    const Vp = Vs[d - 1];
    const iDel = k - 1 + (d - 1);
    const iIns = k + 1 + (d - 1);
    const xDel = iDel >= 0 && iDel < 2 * d - 1 ? Vp[iDel] : -1;
    const xIns = iIns >= 0 && iIns < 2 * d - 1 ? Vp[iIns] : -1;
    const canDel = xDel !== -1 && xDel < n;
    const canIns = xIns !== -1 && xIns - k <= m;
    const delScore = canDel ? xDel + 1 : -2;
    const insScore = canIns ? xIns : -2;
    // Landing point of this depth's edit, before its snake.
    let landX;
    let landY;
    let kind;
    let px;
    let py;
    if (delScore >= insScore) {
      kind = DELETE;
      landX = xDel + 1;
      landY = landX - k;
      px = xDel;
      py = xDel - (k - 1);
      k = k - 1;
    } else {
      kind = INSERT;
      landX = xIns;
      landY = landX - k;
      px = xIns;
      py = xIns - (k + 1);
      k = k + 1;
    }
    // The snake from the landing point to the current point: keeps.
    for (let t = x - landX; t > 0; t--) rev.push(KEEP);
    rev.push(kind);
    x = px;
    y = py;
    d--;
  }
  // The initial snake, from (0, 0) to the current point.
  for (let t = x; t > 0; t--) rev.push(KEEP);
  // Reverse and merge consecutive runs of one kind.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const kind = rev[i];
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === kind) lastRun.count++;
    else runs.push({ kind, count: 1 });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a
 *  line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const intern = new Map();
  const aTexts = [];
  const bTexts = [];
  const a = tokenize(input.old, intern, aTexts);
  const b = tokenize(input.new, intern, bTexts);
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...myersRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const CONTEXT = 3;
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', aTexts[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', aTexts[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bTexts[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', aTexts[at]));
  }
  return out.join('');
}
