/**
 * Pairs the symbols of one expression with the symbols of the next, in order, the way animated
 * math videos carry a symbol from one line to the next. It is a longest common subsequence: a
 * symbol that appears in both, in the same order, keeps its identity and moves; the rest appear
 * or fade. Returns a map from the index of a symbol in `next` to its index in `previous`.
 */
export function matchSymbols(previous: readonly string[], next: readonly string[]): Map<number, number> {
  const n = previous.length;
  const m = next.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = previous[i] === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (previous[i] === next[j]) {
      pairs.set(j, i);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

const MATH = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;

/** The last piece of math in a line: in a worked step, that is the result of the step. */
export function mainMath(line: string): string | null {
  let last: string | null = null;
  for (const match of line.matchAll(MATH)) last = (match[1] ?? match[2]).trim();
  return last;
}
