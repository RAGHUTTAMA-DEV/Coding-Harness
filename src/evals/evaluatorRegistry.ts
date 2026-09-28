import { Evaluator, EvaluatorContext, EvaluatorResult } from "./types";
import { TestEvaluator } from "./evaluators/tests";
import { TypecheckEvaluator } from "./evaluators/typecheck";
import { BuildEvaluator } from "./evaluators/build";
import { LintEvaluator } from "./evaluators/lint";
import { FilesEvaluator } from "./evaluators/files";
import { DiffEvaluator } from "./evaluators/diff";
import { SecurityEvaluator } from "./evaluators/security";
import { RequirementsEvaluator } from "./evaluators/requirements";

export class EvaluatorRegistry {
  private evaluators: Map<string, Evaluator> = new Map();

  constructor() {
    // Register built-in deterministic evaluators by default
    this.register(new TestEvaluator());
    this.register(new TypecheckEvaluator());
    this.register(new BuildEvaluator());
    this.register(new LintEvaluator());
    this.register(new FilesEvaluator());
    this.register(new DiffEvaluator());
    this.register(new SecurityEvaluator());
    this.register(new RequirementsEvaluator());
  }

  register(evaluator: Evaluator): void {
    this.evaluators.set(evaluator.name, evaluator);
  }

  get(name: string): Evaluator | undefined {
    return this.evaluators.get(name);
  }

  getAll(): Evaluator[] {
    return Array.from(this.evaluators.values());
  }

  /**
   * Run all evaluators or a specified subset against the given context
   */
  async evaluateAll(
    context: EvaluatorContext,
    filterNames?: string[]
  ): Promise<Record<string, EvaluatorResult>> {
    const results: Record<string, EvaluatorResult> = {};
    const evaluatorsToRun = filterNames
      ? filterNames.map((name) => this.get(name)).filter((e): e is Evaluator => !!e)
      : this.getAll();

    for (const evaluator of evaluatorsToRun) {
      try {
        const result = await evaluator.evaluate(context);
        results[evaluator.name] = result;
      } catch (err: any) {
        results[evaluator.name] = {
          status: "error",
          score: 0.0,
          error: err.message,
          details: { stack: err.stack }
        };
      }
    }

    return results;
  }
}
