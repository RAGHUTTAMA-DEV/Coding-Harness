import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { readTool } from "../tools/read";
import { writeTool } from "../tools/write";
import { editTool } from "../tools/edit";
import { checkSyntaxTool } from "../tools/checkSyntax";
import { todoReadTool, todoWriteTool } from "../tools/todo";

const testFilePath = path.resolve("./test_temp_file.txt");

describe("Tool Tests", () => {
  beforeEach(async () => {
    // Write a standard multi-line file for testing
    const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 2";
    await fs.writeFile(testFilePath, content, "utf-8");
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch (e) {}
  });

  test("read_file reads complete file with line numbers", async () => {
    const result = await readTool.run({ path: testFilePath });
    expect(result).toContain("1: Line 1");
    expect(result).toContain("2: Line 2");
    expect(result).toContain("3: Line 3");
    expect(result).toContain("4: Line 4");
    expect(result).toContain("5: Line 2");
  });

  test("read_file reads subset of lines", async () => {
    const result = await readTool.run({ path: testFilePath, startLine: 2, endLine: 4 });
    expect(result).not.toContain("1: Line 1");
    expect(result).toContain("2: Line 2");
    expect(result).toContain("3: Line 3");
    expect(result).toContain("4: Line 4");
    expect(result).not.toContain("5: Line 2");
  });

  test("write_file overwrites content successfully", async () => {
    const writeResult = await writeTool.run({ path: testFilePath, content: "New Content" });
    expect(writeResult).toContain("Success");
    
    const readResult = await fs.readFile(testFilePath, "utf-8");
    expect(readResult).toBe("New Content");
  });

  test("edit_file replaces unique block", async () => {
    const editResult = await editTool.run({
      path: testFilePath,
      search: "Line 3\nLine 4",
      replace: "Line Three\nLine Four"
    });
    expect(editResult).toContain("Success");

    const readResult = await fs.readFile(testFilePath, "utf-8");
    expect(readResult).toBe("Line 1\nLine 2\nLine Three\nLine Four\nLine 2");
  });

  test("edit_file fails on duplicate blocks", async () => {
    const editResult = await editTool.run({
      path: testFilePath,
      search: "Line 2",
      replace: "Double line"
    });
    expect(editResult).toContain("Error");
    expect(editResult).toContain("Multiple occurrences");
  });

  test("edit_file fails on missing block", async () => {
    const editResult = await editTool.run({
      path: testFilePath,
      search: "Non existent",
      replace: "Nothing"
    });
    expect(editResult).toContain("Error");
    expect(editResult).toContain("could not be found");
  });

  test("edit_file replaces block with whitespace mismatch", async () => {
    // Write test file with tabs and spaces
    const whitespaceFilePath = path.resolve("./whitespace_test.txt");
    await fs.writeFile(whitespaceFilePath, "  Line One\n  Line Two\n  Line Three", "utf-8");
    try {
      const editResult = await editTool.run({
        path: whitespaceFilePath,
        search: "Line  Two\nLine Three", // mismatch in internal spacing (double space) and indentation
        replace: "Line Two Modified\nLine Three Modified"
      });
      expect(editResult).toContain("Success");
      expect(editResult).toContain("whitespace-tolerant match replaced");

      const readResult = await fs.readFile(whitespaceFilePath, "utf-8");
      expect(readResult).toBe("  Line One\nLine Two Modified\nLine Three Modified");
    } finally {
      await fs.unlink(whitespaceFilePath).catch(() => {});
    }
  });

  test("edit_file fails on multiple whitespace-tolerant matches", async () => {
    const whitespaceFilePath = path.resolve("./whitespace_test_multi.txt");
    await fs.writeFile(whitespaceFilePath, "  Line One\n  Line One", "utf-8");
    try {
      const editResult = await editTool.run({
        path: whitespaceFilePath,
        search: "Line One",
        replace: "Line One Modified"
      });
      expect(editResult).toContain("Error");
      expect(editResult).toContain("Multiple occurrences");
    } finally {
      await fs.unlink(whitespaceFilePath).catch(() => {});
    }
  });

  test("check_syntax returns success for valid file", async () => {
    const validFilePath = path.resolve("./valid_test.js");
    await fs.writeFile(validFilePath, "const a = 1; console.log(a);", "utf-8");
    try {
      const result = await checkSyntaxTool.run({ path: validFilePath });
      expect(result).toContain("Success");
      expect(result).toContain("No syntax or compilation errors found");
    } finally {
      await fs.unlink(validFilePath).catch(() => {});
    }
  });

  test("check_syntax returns errors for invalid file", async () => {
    const invalidFilePath = path.resolve("./invalid_test.js");
    await fs.writeFile(invalidFilePath, "const a = ;", "utf-8");
    try {
      const result = await checkSyntaxTool.run({ path: invalidFilePath });
      expect(result).toContain("Errors found");
      expect(result).toContain("Unexpected");
    } finally {
      await fs.unlink(invalidFilePath).catch(() => {});
    }
  });

  test("edit_file replaces block using exact startLine and endLine", async () => {
    const editResult = await editTool.run({
      path: testFilePath,
      search: "Line 2",
      replace: "Line 5 Replaced",
      startLine: 5,
      endLine: 5
    });
    expect(editResult).toContain("Success");
    expect(editResult).toContain("exact match replaced at lines 5-5");

    const readResult = await fs.readFile(testFilePath, "utf-8");
    expect(readResult).toBe("Line 1\nLine 2\nLine 3\nLine 4\nLine 5 Replaced");
  });

  test("edit_file replaces block using sliding-window line drift", async () => {
    const editResult = await editTool.run({
      path: testFilePath,
      search: "Line 4",
      replace: "Line Four Shifted",
      startLine: 2,
      endLine: 2
    });
    expect(editResult).toContain("Success");
    expect(editResult).toContain("shifted from expected lines 2-2 by 2 lines");

    const readResult = await fs.readFile(testFilePath, "utf-8");
    expect(readResult).toBe("Line 1\nLine 2\nLine 3\nLine Four Shifted\nLine 2");
  });

  test("edit_file prints actual lines on range mismatch", async () => {
    const editResult = await editTool.run({
      path: testFilePath,
      search: "Line 999",
      replace: "Line 999 Replaced",
      startLine: 2,
      endLine: 3
    });
    expect(editResult).toContain("Error");
    expect(editResult).toContain("Actual lines 2-3");
    expect(editResult).toContain("Line 2\nLine 3");
  });

  test("todo_read and todo_write tools manage task list correctly", async () => {
    const todoPath = path.resolve("./.todo.md");
    try {
      await fs.unlink(todoPath).catch(() => {});

      const readResult1 = await todoReadTool.run({});
      expect(readResult1).toContain("No tasks");

      const writeResult = await todoWriteTool.run({ content: "- [ ] Task 1\n- [/] Task 2" });
      expect(writeResult).toContain("Successfully updated");

      const readResult2 = await todoReadTool.run({});
      expect(readResult2).toContain("- [ ] Task 1");
      expect(readResult2).toContain("- [/] Task 2");
    } finally {
      await fs.unlink(todoPath).catch(() => {});
    }
  });
});
