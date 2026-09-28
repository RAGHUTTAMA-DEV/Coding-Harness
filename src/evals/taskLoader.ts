import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EvalTask } from "./types";

export interface DatasetManifest {
  name: string;
  version: string;
  description?: string;
  tasks: string[]; // Paths or IDs
}

export class TaskLoader {
  private datasetsRoot: string;

  constructor(datasetsRoot?: string) {
    if (datasetsRoot) {
      this.datasetsRoot = path.resolve(datasetsRoot);
    } else {
      // Default to evals/datasets in workspace root
      this.datasetsRoot = path.resolve(process.cwd(), "evals", "datasets");
    }
  }

  /**
   * Load a single task from a JSON file path
   */
  loadTaskFromFile(filePath: string): EvalTask {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Task file not found: ${fullPath}`);
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    const task = JSON.parse(content) as EvalTask;
    return task;
  }

  /**
   * Recursively scan a directory for task.json files
   */
  discoverTasks(dirPath: string): EvalTask[] {
    const tasks: EvalTask[] = [];
    if (!fs.existsSync(dirPath)) {
      return tasks;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        tasks.push(...this.discoverTasks(fullPath));
      } else if (entry.isFile() && (entry.name === "task.json" || entry.name.endsWith(".task.json"))) {
        try {
          const task = this.loadTaskFromFile(fullPath);
          tasks.push(task);
        } catch {
          // Ignore invalid files
        }
      }
    }

    return tasks;
  }

  /**
   * Load all tasks for a given dataset name
   */
  loadDataset(datasetName: string = "coding-harness-v1"): EvalTask[] {
    const datasetDir = path.resolve(this.datasetsRoot, datasetName);
    if (!fs.existsSync(datasetDir)) {
      // If default path does not exist, return empty
      return [];
    }

    // Check if manifest.json exists
    const manifestPath = path.join(datasetDir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as DatasetManifest;
        const loadedTasks: EvalTask[] = [];
        for (const taskRelPath of manifest.tasks) {
          const fullTaskPath = path.resolve(datasetDir, taskRelPath);
          if (fs.existsSync(fullTaskPath)) {
            if (fs.statSync(fullTaskPath).isDirectory()) {
              const taskJson = path.join(fullTaskPath, "task.json");
              if (fs.existsSync(taskJson)) {
                loadedTasks.push(this.loadTaskFromFile(taskJson));
              }
            } else {
              loadedTasks.push(this.loadTaskFromFile(fullTaskPath));
            }
          }
        }
        if (loadedTasks.length > 0) {
          return loadedTasks;
        }
      } catch {
        // Fall back to directory walk
      }
    }

    return this.discoverTasks(datasetDir);
  }

  /**
   * Find a specific task by ID across loaded datasets
   */
  findTaskById(taskId: string, datasetName: string = "coding-harness-v1"): EvalTask | undefined {
    const tasks = this.loadDataset(datasetName);
    return tasks.find((t) => t.id === taskId);
  }

  /**
   * Prepares an isolated execution workspace for the task.
   * Copies fixture files if specified, otherwise creates an empty isolated directory.
   */
  createIsolatedWorkspace(task: EvalTask, runId: string): string {
    const tempBase = path.join(os.tmpdir(), "coding-harness-evals", runId, task.id);
    if (fs.existsSync(tempBase)) {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
    fs.mkdirSync(tempBase, { recursive: true });

    // If repository fixture is specified, copy it over
    let fixturePath: string | undefined;
    if (task.repository?.path) {
      fixturePath = path.resolve(task.repository.path);
    } else if (task.repository?.fixture) {
      // Check in dataset fixtures directory
      const candidates = [
        path.resolve(this.datasetsRoot, "fixtures", task.repository.fixture),
        path.resolve(this.datasetsRoot, "..", "fixtures", task.repository.fixture),
        path.resolve(process.cwd(), "evals", "fixtures", task.repository.fixture)
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          fixturePath = cand;
          break;
        }
      }
    }

    if (fixturePath && fs.existsSync(fixturePath)) {
      this.copyDirectoryRecursive(fixturePath, tempBase);
    }

    return tempBase;
  }

  /**
   * Injects hidden tests into the workspace (performed strictly AFTER agent completion)
   */
  injectHiddenTests(workspaceDir: string, task: EvalTask): void {
    if (!task.hiddenTests?.files || task.hiddenTests.files.length === 0) {
      return;
    }

    for (const hiddenFile of task.hiddenTests.files) {
      const destPath = path.resolve(workspaceDir, hiddenFile.path);
      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(destPath, hiddenFile.content, "utf-8");
    }
  }

  /**
   * Clean up isolated workspace
   */
  cleanupWorkspace(workspaceDir: string): void {
    try {
      if (fs.existsSync(workspaceDir)) {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  }

  private copyDirectoryRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      // Skip node_modules or .git if not strictly needed
      if (entry.name === ".git") continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
