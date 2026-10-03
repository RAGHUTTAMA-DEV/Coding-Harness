# Coding-Harness — Recovery Engine & Loop Detection

## 1. Overview

The **Recovery Engine** and **Loop Detection** subsystem provides autonomous self-healing capabilities for the Coding-Harness runtime, implementing **Specification Sections 29, 30, and 34**.

A primary principle of Coding-Harness is:
> **The agent proposes and executes changes. The harness verifies whether the task actually succeeded and recovers safely from failures.**

When tools fail, code modifications introduce errors, verification test suites fail, or cyclical edits occur, the runtime does **not** terminate abruptly or loop indefinitely. Instead, it classifies the incident, detects repetitive patterns, and executes an appropriate recovery strategy.

---

## 2. Target Architecture

```text
               Tool Execution / Verification Command
                                │
                                ▼
                       ┌─────────────────┐
                       │  Loop Detector  │
                       └────────┬────────┘
                                │
                        Pattern Checked
                                │
                                ▼
                       ┌─────────────────┐
                       │FailureClassifier│
                       └────────┬────────┘
                                │
                           FailureClass
                                │
                                ▼
                       ┌─────────────────┐
                       │ Recovery Engine │
                       └────────┬────────┘
                                │
                        Escalation Ladder
                                │
           ┌───────────┬────────┼───────────┬───────────┐
           ▼           ▼        ▼           ▼           ▼
        [RETRY]    [INSPECT] [REPLAN]   [ROLLBACK]   [ABORT]
           │           │        │           │           │
           └───────────┴────────┴───────────┴───────────┘
                                │
                                ▼
                Injected Guidance into Context
```

---

## 3. Failure Classification

Failures are categorized into 10 canonical classes:

| Failure Class | Description | Trigger Conditions |
|---|---|---|
| `TEST_FAILURE` | Automated test suite execution failed | `npm test`, `jest`, `vitest`, `bun test` non-zero exit or `FAIL`/assertion error output |
| `TYPECHECK_FAILURE` | Static typecheck compilation error | `tsc --noEmit` non-zero exit or `TS2322`, `TS2304` error codes |
| `BUILD_FAILURE` | Project build step failed | `npm run build`, `vite build` non-zero exit or `SyntaxError` |
| `POLICY_BLOCK` | Guardrail security policy blocked action | `DENY` decision from `PolicyEngine`, forbidden paths, risky operations |
| `REPEATED_FAILURE` | Repetitive failure cycle detected | `LoopDetector` signals identical tool failures or cyclic behavior |
| `MODEL_FAILURE` | LLM generation or client error | Rate limits (HTTP 429), context length limits, invalid JSON tool calls |
| `TIMEOUT` | Operation exceeded time limits | Tool execution or model streaming timeout |
| `STALL` | Process stall without forward progress | Stall detector alert |
| `BUDGET_EXCEEDED` | Task execution resource cap exhausted | Iteration cap, tool call cap, or token cap reached |
| `TOOL_FAILURE` | General filesystem or tool error | File not found, invalid parameters, edit mismatch |

---

## 4. Loop Detection

The `LoopDetector` maintains a sliding window of recent tool actions, signatures, and outcomes. It detects:

1. **Identical Consecutive Failures**:
   - The same tool called with identical parameters failing $N$ consecutive times (default threshold: 3).
2. **Repeated Test Failures**:
   - Test commands repeatedly failing without progress between runs.
3. **Cyclic Multi-Step Patterns**:
   - Repeating sequences (e.g. `read_file` $\to$ `edit_file` $\to$ `run_command` $\to$ `read_file` $\to$ `edit_file` $\to$ `run_command`) where the cycle ends in failure.

When a loop is detected, the loop detector alerts the Recovery Engine to bypass single-step retries and escalate immediately to `REPLAN` or `ROLLBACK`.

---

## 5. Recovery Strategies & Escalation Ladder

The Recovery Engine executes a progressive escalation ladder:

```text
[Failure 1]      ──►  RETRY (Transient network, model parsing, or minor parameter correction)
[Failure 2]      ──►  INSPECT (Mandatory diagnostics: inspect test assertions, file lines)
[Failure 3]      ──►  REPLAN (Discard failing hypothesis, formulate revised TODO plan)
[Loop / Critical]──►  ROLLBACK (Revert workspace via SnapshotManager to clean snapshot)
[Exhausted]      ──►  ASK_USER / ABORT (Safely halt without corrupting workspace)
```

### Available Strategies

- **`RETRY`** (`RetryStrategy`):
  - Retries the operation with parameter adjustments or backoff.
  - Enforces `maxConsecutiveRetries` (default: 2) to prevent infinite loops.
- **`INSPECT`** (`InspectStrategy`):
  - Injects diagnostic instructions directing the agent to use `read_file`, `glob`, or review exact compiler error outputs rather than guessing.
- **`REPLAN`** (`ReplanStrategy`):
  - Prompts the agent to abandon the failing approach and write a revised task checklist using `todo_write`.
- **`ROLLBACK`** (`RollbackStrategy`):
  - Reverts modified and deleted workspace files using `SnapshotManager.restoreSnapshot()`.
  - Cleans untracked files generated during the broken attempt.
- **`ASK_USER`** (`AskUserStrategy`):
  - Prompts human steering in interactive terminal sessions.
- **`ABORT`** (`AbortStrategy`):
  - Safely stops the agent when limits are exhausted (`maxTotalRecoveries` or `BUDGET_EXCEEDED`).

---

## 6. Agent Integration

The `Agent` loop in `src/agent.ts` automatically runs every tool result through the Recovery Engine:

```typescript
const agent = new Agent({
  client,
  cwd: "./my-project",
  recoveryEngine: new RecoveryEngine({
    workspaceDir: "./my-project",
    snapshotManager: agentSnapshotManager,
    limits: {
      maxConsecutiveRetries: 2,
      maxTotalRecoveries: 10,
      maxRollbacks: 3
    }
  })
});

await agent.run("Refactor database layer", {
  onRecoveryStarted: (context, action) => {
    console.log(`[Recovery Started] ${action} for ${context.failureClass}`);
  },
  onRecoveryCompleted: (result) => {
    console.log(`[Recovery Completed] ${result.message}`);
  },
  onLoopDetected: (loopResult) => {
    console.warn(`[Loop Detected] ${loopResult.pattern} (${loopResult.count}x)`);
  }
});
```

---

## 7. Verification Tests

Automated tests for this subsystem are located in `src/tests/recovery.test.ts`:
- Failure classification for all 10 failure classes.
- Loop detection for identical tool failures, test failures, and multi-step cycles.
- Strategy execution for retry limits, inspect prompts, replan generation, rollback, and abort.
- RecoveryEngine escalation ladder and state machine transitions.
- End-to-end Agent integration verifying loop detection and recovery steering message injection.
