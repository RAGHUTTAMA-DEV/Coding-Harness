export interface DiffHunk {
  type: "added" | "removed" | "unchanged";
  content: string;
}

/**
 * Computes a line-by-line diff between two strings using the Longest Common Subsequence (LCS) algorithm.
 */
export function computeDiff(oldStr: string, newStr: string): DiffHunk[] {
  const oldLines = oldStr === "" ? [] : oldStr.split(/\r?\n/);
  const newLines = newStr === "" ? [] : newStr.split(/\r?\n/);

  const m = oldLines.length;
  const n = newLines.length;

  // DP table for LCS
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const diff: DiffHunk[] = [];
  let i = m;
  let j = n;

  // Backtrack to build the diff
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.push({ type: "unchanged", content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({ type: "added", content: newLines[j - 1] });
      j--;
    } else {
      diff.push({ type: "removed", content: oldLines[i - 1] });
      i--;
    }
  }

  return diff.reverse();
}

/**
 * Formats line diffs into a unified diff string with ANSI colors and 3 lines of context.
 * Unchanged blocks larger than 6 lines will have their middles collapsed.
 */
export function formatDiff(diff: DiffHunk[], contextSize = 3): string {
  if (diff.length === 0) {
    return "No changes detected.";
  }

  const n = diff.length;
  const printFlags = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    if (diff[i].type !== "unchanged") {
      const start = Math.max(0, i - contextSize);
      const end = Math.min(n - 1, i + contextSize);
      for (let k = start; k <= end; k++) {
        printFlags[k] = true;
      }
    }
  }

  let output = "";
  let inHunk = false;

  for (let i = 0; i < n; i++) {
    if (printFlags[i]) {
      if (!inHunk) {
        // Start of a new hunk
        inHunk = true;
        output += `\x1b[36m@@ Hunk @@\x1b[0m\n`;
      }

      const hunk = diff[i];
      if (hunk.type === "added") {
        output += `\x1b[32m+ ${hunk.content}\x1b[0m\n`;
      } else if (hunk.type === "removed") {
        output += `\x1b[31m- ${hunk.content}\x1b[0m\n`;
      } else {
        output += `\x1b[90m  ${hunk.content}\x1b[0m\n`;
      }
    } else {
      if (inHunk) {
        // Just left a printed hunk, count how many lines are skipped
        let skipped = 0;
        while (i < n && !printFlags[i]) {
          skipped++;
          i++;
        }
        i--; 
        output += `\x1b[90m... [${skipped} lines unchanged] ...\x1b[0m\n`;
        inHunk = false;
      }
    }
  }

  return output.trimEnd();
}
