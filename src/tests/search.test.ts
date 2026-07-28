import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { globTool } from "../tools/glob";
import { grepTool } from "../tools/grep";

const testDir = path.resolve("./test_search_dir");
const file1 = path.join(testDir, "file1.txt");
const file2 = path.join(testDir, "subdir", "file2.js");

describe("Search Tools Tests (Glob & Grep)", () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(testDir, "subdir"), { recursive: true });
    await fs.writeFile(file1, "Hello Antigravity world!\nFind this key phrase.", "utf-8");
    await fs.writeFile(file2, "const test = 'value';\n// Find this key phrase too.", "utf-8");
  });

  afterEach(async () => {
    try {
      await fs.unlink(file1);
      await fs.unlink(file2);
      await fs.rm(path.join(testDir, "subdir"), { recursive: true });
      await fs.rm(testDir, { recursive: true });
    } catch (e) {}
  });

  test("glob lists files correctly", async () => {
    const result = await globTool.run({ pattern: "test_search_dir/**/*" });
    expect(result).toContain("test_search_dir/file1.txt");
    expect(result).toContain("test_search_dir/subdir/file2.js");
  });

  test("glob handles specific pattern filters", async () => {
    const result = await globTool.run({ pattern: "test_search_dir/**/*.js" });
    expect(result).not.toContain("test_search_dir/file1.txt");
    expect(result).toContain("test_search_dir/subdir/file2.js");
  });

  test("grep finds literal substrings across files", async () => {
    const result = await grepTool.run({ pattern: "key phrase", glob: "test_search_dir/**/*" });
    expect(result).toContain("test_search_dir/file1.txt:2: Find this key phrase.");
    expect(result).toContain("test_search_dir/subdir/file2.js:2: // Find this key phrase too.");
  });

  test("grep handles regex pattern searches", async () => {
    const result = await grepTool.run({ pattern: "/const \\w+ =/", glob: "test_search_dir/**/*" });
    expect(result).toContain("test_search_dir/subdir/file2.js:1: const test = 'value';");
    expect(result).not.toContain("test_search_dir/file1.txt");
  });
});
