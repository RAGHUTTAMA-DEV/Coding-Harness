import * as fs from "fs/promises";
import * as path from "path";
import { Tool } from "./types";

export const editTool: Tool = {
  name: "edit_file",
  description: "Edit a file by finding a specific block of text and replacing it with a new block. Optionally target a specific line range with startLine and endLine for safety and precision. If target line numbers have shifted, a sliding-window search is automatically performed to locate the block.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the file to edit."
      },
      search: {
        type: "string",
        description: "The exact block of code to search for. Must be a unique block in the file or range."
      },
      replace: {
        type: "string",
        description: "The block of code to replace the search block with."
      },
      startLine: {
        type: "integer",
        description: "The starting line number of the block to replace (1-indexed, optional). If provided, helps target the specific line range."
      },
      endLine: {
        type: "integer",
        description: "The ending line number of the block to replace (1-indexed, inclusive, optional). If provided, helps target the specific line range."
      }
    },
    required: ["path", "search", "replace"]
  },
  isMutating: true,
  async run(args: { path: string; search: string; replace: string; startLine?: number; endLine?: number }): Promise<string> {
    try {
      const targetPath = path.resolve(args.path);
      
      // Check if file exists
      try {
        await fs.access(targetPath);
      } catch (err) {
        return `Error: File not found at '${args.path}'.`;
      }

      const content = await fs.readFile(targetPath, "utf-8");
      
      // Helper function to count occurrences of a substring
      const countOccurrences = (str: string, subStr: string) => {
        if (subStr.length === 0) return 0;
        let count = 0;
        let pos = 0;
        while ((pos = str.indexOf(subStr, pos)) !== -1) {
          count++;
          pos += subStr.length;
        }
        return count;
      };

      const normalize = (str: string) => str.replace(/\r\n/g, "\n");
      const cleanLine = (line: string) => line.trim().replace(/\s+/g, " ");

      // Detect original line endings style
      const crlfCount = (content.match(/\r\n/g) || []).length;
      const lfCount = (content.match(/[^\r]\n/g) || []).length;
      const useCrlf = crlfCount > lfCount;

      const contentLines = content.split(/\r?\n/);

      // 1. Line-Targeted Mode
      if (args.startLine !== undefined || args.endLine !== undefined) {
        const startLine = args.startLine !== undefined ? args.startLine : 1;
        const endLine = args.endLine !== undefined ? args.endLine : contentLines.length;

        if (startLine < 1 || endLine < startLine || startLine > contentLines.length) {
          return `Error: Invalid line range specifying startLine = ${args.startLine}, endLine = ${args.endLine} (file has ${contentLines.length} lines).`;
        }

        // Helper to check if a specific range matches the search string
        const checkRangeMatch = (start: number, end: number): { matches: boolean; type: "exact" | "whitespace" | "none" } => {
          if (start < 1 || end > contentLines.length || start > end) {
            return { matches: false, type: "none" };
          }
          const rangeLines = contentLines.slice(start - 1, end);
          const rangeStr = rangeLines.join("\n");
          
          // Try exact match
          if (normalize(rangeStr) === normalize(args.search)) {
            return { matches: true, type: "exact" };
          }

          // Try whitespace-tolerant match
          const searchLines = normalize(args.search).split("\n");
          if (searchLines.length === rangeLines.length) {
            let match = true;
            for (let i = 0; i < searchLines.length; i++) {
              if (cleanLine(rangeLines[i]) !== cleanLine(searchLines[i])) {
                match = false;
                break;
              }
            }
            if (match) {
              return { matches: true, type: "whitespace" };
            }
          }

          return { matches: false, type: "none" };
        };

        // Try exact/whitespace match at target range first
        const directMatch = checkRangeMatch(startLine, endLine);
        if (directMatch.matches) {
          const beforeLines = contentLines.slice(0, startLine - 1);
          const afterLines = contentLines.slice(endLine);
          const newNormalizedContent = [...beforeLines, normalize(args.replace), ...afterLines].join("\n");
          const finalContent = useCrlf ? newNormalizedContent.replace(/\n/g, "\r\n") : newNormalizedContent;
          await fs.writeFile(targetPath, finalContent, "utf-8");
          return `Success: Edited file '${args.path}' successfully (${directMatch.type} match replaced at lines ${startLine}-${endLine}).`;
        }

        // Slide window up to ±10 lines to locate shifted match
        const maxOffset = 10;
        const offsetMatches: { offset: number; type: "exact" | "whitespace" | "none" }[] = [];

        // Check offset = 1, -1, 2, -2, etc.
        for (let offset = 1; offset <= maxOffset; offset++) {
          for (const sign of [1, -1]) {
            const shift = offset * sign;
            const matchResult = checkRangeMatch(startLine + shift, endLine + shift);
            if (matchResult.matches) {
              offsetMatches.push({ offset: shift, type: matchResult.type });
            }
          }
        }

        if (offsetMatches.length === 1) {
          const { offset, type } = offsetMatches[0];
          const newStart = startLine + offset;
          const newEnd = endLine + offset;
          const beforeLines = contentLines.slice(0, newStart - 1);
          const afterLines = contentLines.slice(newEnd);
          const newNormalizedContent = [...beforeLines, normalize(args.replace), ...afterLines].join("\n");
          const finalContent = useCrlf ? newNormalizedContent.replace(/\n/g, "\r\n") : newNormalizedContent;
          await fs.writeFile(targetPath, finalContent, "utf-8");
          return `Success: Edited file '${args.path}' successfully (${type} match replaced at lines ${newStart}-${newEnd}, shifted from expected lines ${startLine}-${endLine} by ${offset} lines).`;
        }

        if (offsetMatches.length > 1) {
          return `Error: Multiple matching ranges found for the search block within the sliding window around lines ${startLine}-${endLine}. Please provide more context or verify the search block.`;
        }

        // No match found - return detailed diagnostics
        const actualRangeSnippet = contentLines.slice(startLine - 1, Math.min(contentLines.length, endLine)).join("\n");
        return `Error: The search block could not be found near lines ${startLine}-${endLine}.
Actual lines ${startLine}-${endLine}:
${actualRangeSnippet}

Expected search block:
${args.search}

If you are unsure of the file content, run 'read_file' first to inspect the exact indentation and spacing.`;
      }

      // 2. Global Search Mode (original fallback)
      // Try exact match first
      let occurrences = countOccurrences(content, args.search);
      if (occurrences === 1) {
        const updatedContent = content.replace(args.search, args.replace);
        await fs.writeFile(targetPath, updatedContent, "utf-8");
        return `Success: Edited file '${args.path}' successfully (exact match replaced).`;
      }

      // Try line-ending normalization
      const normalizedContent = normalize(content);
      const normalizedSearch = normalize(args.search);
      const normalizedReplace = normalize(args.replace);

      occurrences = countOccurrences(normalizedContent, normalizedSearch);
      if (occurrences === 1) {
        const updatedNormalizedContent = normalizedContent.replace(normalizedSearch, normalizedReplace);
        const finalContent = useCrlf ? updatedNormalizedContent.replace(/\n/g, "\r\n") : updatedNormalizedContent;
        await fs.writeFile(targetPath, finalContent, "utf-8");
        return `Success: Edited file '${args.path}' successfully (normalized line-endings match replaced).`;
      }

      if (occurrences > 1) {
        return `Error: Multiple occurrences (${occurrences}) of the search block were found in '${args.path}'. Please provide more surrounding context to make the search block unique.`;
      }

      // Try whitespace-tolerant match
      const searchLines = normalizedSearch.split("\n");
      const cleanSearchLines = searchLines.map(cleanLine);

      const matchIndices: number[] = [];
      const normalizedContentLines = normalizedContent.split("\n");
      for (let i = 0; i <= normalizedContentLines.length - searchLines.length; i++) {
        let match = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (cleanLine(normalizedContentLines[i + j]) !== cleanSearchLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          matchIndices.push(i);
        }
      }

      if (matchIndices.length === 0) {
        return `Error: The search block could not be found in '${args.path}'. If you are unsure of the file content, run 'read_file' first to inspect the exact indentation and spacing.`;
      }

      if (matchIndices.length > 1) {
        return `Error: Multiple occurrences (${matchIndices.length}) of the search block were found in '${args.path}' under whitespace-tolerant matching. Please provide more surrounding context to make the search block unique.`;
      }

      const matchIdx = matchIndices[0];
      const beforeLines = normalizedContentLines.slice(0, matchIdx);
      const afterLines = normalizedContentLines.slice(matchIdx + searchLines.length);
      const newNormalizedContent = [...beforeLines, normalizedReplace, ...afterLines].join("\n");
      const finalContent = useCrlf ? newNormalizedContent.replace(/\n/g, "\r\n") : newNormalizedContent;
      
      await fs.writeFile(targetPath, finalContent, "utf-8");
      return `Success: Edited file '${args.path}' successfully (whitespace-tolerant match replaced).`;
    } catch (error: any) {
      return `Error editing file: ${error.message}`;
    }
  }
};
