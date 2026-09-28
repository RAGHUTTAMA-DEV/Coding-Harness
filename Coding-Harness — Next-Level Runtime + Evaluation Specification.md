# Coding-Harness — Next-Level Runtime Upgrade

## Mission

Upgrade the existing Coding-Harness into a production-oriented autonomous coding-agent runtime.

The goal is NOT to build another simple coding chatbot.

The goal is to build a runtime that can execute coding tasks autonomously while providing:

- objective evaluation
- verification-driven completion
- strong guardrails
- MCP tool integration
- long-running task execution
- workspace snapshots
- rollback
- failure detection
- recovery
- reproducibility
- structured observability
- benchmarkable agent performance

The central principle is:

> **The agent proposes and executes changes. The harness verifies whether the task actually succeeded.**

---

# 1. FIRST: INSPECT THE EXISTING SYSTEM

Before making changes, inspect the complete repository.

Understand:

- Agent loop
- tool registry
- tool definitions
- permission system
- command execution
- context manager
- context compaction
- session/tree system
- sub-agent system
- provider abstraction
- CLI
- persistence
- existing tests
- existing documentation

Do not rewrite working components unnecessarily.

Reuse existing abstractions.

Before implementation, create a TODO plan and execute it incrementally.

---

# 2. TARGET ARCHITECTURE

The target execution architecture is:

```text
                         USER TASK
                             │
                             ▼
                    ┌─────────────────┐
                    │ Task Analyzer   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Task Planner    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Agent Runtime  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
          Built-in        MCP Tools      Subagents
           Tools              │
              │               │
              └───────┬───────┘
                      ▼
              ┌─────────────────┐
              │ Guardrail Engine│
              └────────┬────────┘
                       │
                 ALLOW / ASK / DENY
                       │
                       ▼
              ┌─────────────────┐
              │ Execution Layer │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Checkpoints   │
              │   / Snapshots   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Verification   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Evaluation      │
              │ Engine          │
              └────────┬────────┘
                       │
                  PASS / FAIL
                       │
              ┌────────┴─────────┐
              ▼                  ▼
           SUCCESS            RECOVERY
                                  │
                                  ▼
                             REPLAN /
                             RETRY /
                             ROLLBACK /
                             ASK USER
```

---

# 3. EVALUATION ENGINE

Build a first-class evaluation subsystem.

Suggested structure:

```text
src/
└── evals/
    ├── types.ts
    ├── evalRunner.ts
    ├── taskLoader.ts
    ├── evaluatorRegistry.ts
    │
    ├── evaluators/
    │   ├── tests.ts
    │   ├── typecheck.ts
    │   ├── build.ts
    │   ├── lint.ts
    │   ├── diff.ts
    │   ├── requirements.ts
    │   ├── security.ts
    │   └── files.ts
    │
    └── reports/
        └── reportGenerator.ts
```

The evaluation engine must be independent of the Agent implementation.

The Agent should not contain evaluator-specific logic.

---

# 4. DETERMINISTIC EVALUATORS

Implement objective evaluators first.

Required evaluators:

### Tests

Run the repository test suite.

Record:

- total tests
- passed
- failed
- skipped
- duration
- exit code

### Typecheck

Examples:

```bash
tsc --noEmit
```

or the project's configured equivalent.

### Build

Verify the project builds successfully.

### Lint

Run configured linting.

### File evaluator

Verify:

- required files exist
- forbidden files were not modified
- expected paths changed
- unexpected paths were not modified

### Diff evaluator

Analyze:

- files changed
- lines added
- lines removed
- deleted files
- new dependencies
- sensitive files changed

### Requirement evaluator

Verify explicit task requirements.

### Security evaluator

Check:

- secrets
- dangerous commands
- unsafe file access
- suspicious dependencies
- forbidden paths

---

# 5. OPTIONAL LLM EVALUATORS

Support LLM-based evaluation as an additional evaluator.

Possible dimensions:

- requirement adherence
- code quality
- maintainability
- architectural consistency
- explanation quality

But:

> LLM judges must NEVER be the only source of truth for coding-task success.

Prefer deterministic evidence.

Keep evaluator outputs separate.

---

# 6. EVALUATION TASK FORMAT

Create a machine-readable benchmark task format.

Example:

```json
{
  "id": "auth-jwt-001",
  "version": "1.0",

  "category": "feature",

  "description": "Implement JWT authentication",

  "repository": {
    "fixture": "auth-service"
  },

  "prompt": "Add JWT authentication to the application.",

  "requirements": [
    "POST /login returns a JWT",
    "Protected routes reject missing tokens",
    "Invalid tokens return HTTP 401"
  ],

  "verification": {
    "commands": [
      "npm test",
      "npm run typecheck"
    ]
  },

  "constraints": {
    "forbiddenPaths": [
      ".env",
      "node_modules"
    ]
  },

  "limits": {
    "maxIterations": 40,
    "maxToolCalls": 100,
    "maxExecutionTimeSeconds": 1200
  }
}
```

Support dataset versioning.

---

# 7. EVALUATION DATASET

Do not create a dataset consisting only of random prompts.

Create realistic software-engineering tasks with known expected behavior.

Recommended initial benchmark:

## 50 tasks

```text
Bug Fixing              10
Feature Implementation  10
Refactoring              5
Debugging                5
Test Writing             5
Security                 5
Repository Navigation    5
Multi-Step Tasks         5
──────────────────────────
TOTAL                   50
```

---

# 8. DATASET STRUCTURE

Create:

```text
evals/
└── datasets/
    └── coding-harness-v1/
        ├── manifest.json
        │
        ├── bug-fix/
        │   ├── BUG-001/
        │   │   ├── task.json
        │   │   ├── repo/
        │   │   └── tests/
        │   │
        │   └── BUG-002/
        │
        ├── feature/
        ├── refactor/
        ├── debugging/
        ├── testing/
        ├── security/
        ├── repo-navigation/
        └── multi-step/
```

Each task must have:

```text
Task description
Initial repository
Expected behavior
Visible requirements
Hidden tests
Constraints
Evaluation criteria
```

---

# 9. DATASET QUALITY RULES

Every task must have objectively testable success criteria.

Avoid vague tasks such as:

```text
"Improve the code."
"Make this better."
"Refactor this nicely."
```

Prefer:

```text
"Add pagination to GET /users."

Expected:

GET /users
GET /users?page=2
GET /users?limit=10

must behave according to the specification.
```

Each task should have a known expected outcome.

---

# 10. HIDDEN TESTS

Where possible, create hidden tests.

The Agent receives:

```text
Task
Visible requirements
Repository
```

The Agent should NOT receive:

```text
Hidden tests
Expected implementation
Exact assertions
```

Example:

```text
Task:
Add rate limiting to /api/login.
```

Hidden tests may check:

```text
request limits
counter reset
concurrent requests
different clients/IPs
invalid configuration
response format
existing endpoint behavior
```

This prevents the agent from simply optimizing for visible tests.

---

# 11. TASK DIFFICULTY

Each evaluation task should have a difficulty level:

```text
L1 — Simple
L2 — Moderate
L3 — Complex
L4 — Multi-step
L5 — Long-running
```

Store difficulty in task metadata.

Example:

```json
{
  "id": "FEAT-004",
  "difficulty": "L3"
}
```

---

# 12. REALISTIC FAILURE TASKS

The benchmark must intentionally include tasks designed to expose agent weaknesses.

Examples:

### Context navigation

Relevant code exists across multiple directories.

### Debugging

The error message points to a symptom rather than the root cause.

### Regression

Fixing one feature must not break existing behavior.

### Security

Implementation must handle malicious input.

### Multi-step

Task requires:

```text
schema
→ migration
→ service
→ API
→ tests
→ documentation
```

### Long-running

Task requires many tool calls and multiple verification cycles.

---

# 13. EVALUATION RESULT SCHEMA

Every evaluation run must produce structured output.

Example:

```json
{
  "runId": "run-123",

  "dataset": "coding-harness-v1",

  "taskId": "auth-jwt-001",

  "status": "passed",

  "evaluators": {
    "tests": {
      "status": "passed",
      "score": 1,
      "passed": 24,
      "failed": 0
    },

    "typecheck": {
      "status": "passed",
      "score": 1
    },

    "build": {
      "status": "passed",
      "score": 1
    },

    "requirements": {
      "status": "passed",
      "score": 0.95
    },

    "security": {
      "status": "passed",
      "score": 1
    }
  },

  "metrics": {
    "iterations": 17,
    "toolCalls": 32,
    "tokens": 28000,
    "durationMs": 143000,
    "filesChanged": 6,
    "recoveryAttempts": 1,
    "rollbackCount": 0,
    "guardrailBlocks": 1,
    "mcpCalls": 3
  }
}
```

Do not collapse all information into a single score.

Preserve evaluator evidence.

---

# 14. EVALUATION REPORT

Generate a human-readable report.

Example:

```text
══════════════════════════════════════
       CODING-HARNESS EVALUATION
══════════════════════════════════════

Task:
Add JWT authentication

Status:
✓ PASSED

Verification:

Tests             24/24 ✓
Typecheck         PASS ✓
Build             PASS ✓
Requirements      95% ✓
Security          PASS ✓

Execution:

Iterations        17
Tool Calls        32
MCP Calls          3
Recoveries         1
Rollbacks          0
Guardrail Blocks   1

Tokens            28,000
Duration          2m 23s

Files Changed      6

══════════════════════════════════════
             VERIFIED ✓
══════════════════════════════════════
```

---

# 15. BENCHMARK RUNNER

Create a benchmark runner capable of executing the complete dataset.

Example:

```bash
harness eval run coding-harness-v1
```

Support:

```bash
harness eval list

harness eval run coding-harness-v1

harness eval run --category bug-fix

harness eval run --task BUG-001

harness eval report <run-id>
```

The benchmark runner should isolate each task.

A failed task must not corrupt the next task.

---

# 16. MODEL COMPARISON

The benchmark system should support running the same dataset against different models.

Example:

```text
                  Coding-Harness Eval Suite

                    50 benchmark tasks

               ┌────────┼────────┐
               ▼        ▼        ▼
            Model A  Model B  Model C
               │        │        │
               ▼        ▼        ▼
             50 runs  50 runs  50 runs
               │        │        │
               └────────┼────────┘
                        ▼
                 Evaluation Engine
                        │
                        ▼
                    Reports
```

Track:

- success rate
- test pass rate
- average iterations
- average tool calls
- average tokens
- average duration
- recovery rate
- rollback rate
- guardrail blocks
- MCP usage

Do not present model comparisons as absolute conclusions.

The benchmark should clearly identify:

- model version
- harness version
- dataset version
- evaluator version
- configuration

---

# 17. HARNESS ABLATION TESTING

Use the benchmark to measure whether Coding-Harness features actually help.

Run experiments such as:

```text
Baseline Agent

vs

Agent + Verification

vs

Agent + Verification + Recovery

vs

Agent + Verification + Recovery + Snapshots

vs

Full Harness
```

Measure:

```text
Task Success
Recovery Success
Average Tool Calls
Execution Time
Token Usage
Failure Rate
Regression Rate
```

This is important.

The project should demonstrate that the runtime features improve reliability rather than simply adding complexity.

---

# 18. GUARDRAIL ENGINE

Create:

```text
src/guardrails/

    policyEngine.ts
    commandPolicy.ts
    pathPolicy.ts
    networkPolicy.ts
    secretScanner.ts
    resourcePolicy.ts
    types.ts
```

Every tool invocation must pass through the policy layer.

Policies:

```text
ALLOW
ASK
DENY
```

---

# 19. COMMAND RISK CLASSIFICATION

Do not classify commands only by tool name.

Inspect the actual command.

Examples:

```text
git status          LOW
npm test            LOW
npm run build       LOW
npm install         MEDIUM
git commit          HIGH
git push            HIGH
git push --force    CRITICAL
rm file.txt         HIGH
rm -rf /            CRITICAL
```

Policy must be configurable.

---

# 20. PATH SECURITY

Prevent filesystem escape.

Resolve all paths before execution.

Reject paths outside the workspace unless explicitly allowed.

Protect:

```text
.env
credentials
SSH keys
private keys
system directories
user home directories
```

---

# 21. SECRET SCANNER

Detect and redact:

- API keys
- tokens
- private keys
- passwords
- credentials
- .env files

Secrets must not appear in:

- logs
- traces
- evaluation reports
- model-visible error messages where avoidable

---

# 22. MCP CLIENT

Implement an MCP client subsystem.

Suggested:

```text
src/mcp/

    client.ts
    manager.ts
    serverRegistry.ts
    toolAdapter.ts
    types.ts
```

Architecture:

```text
MCP SERVER
     ↓
MCP CLIENT
     ↓
MCP TOOL ADAPTER
     ↓
HARNESS TOOL REGISTRY
     ↓
GUARDRAIL ENGINE
     ↓
AGENT
```

MCP tools must NOT bypass guardrails.

Support:

- connect
- initialize
- tool discovery
- tool execution
- timeout
- reconnect
- disconnect
- server failure
- schema validation

---

# 23. LONG-RUNNING TASK RUNTIME

Support tasks lasting many minutes or longer.

Task states:

```text
CREATED
RUNNING
PAUSED
WAITING
RECOVERING
COMPLETED
FAILED
CANCELLED
```

Persist:

```text
run ID
task state
conversation
plan
current iteration
tool state
budgets
checkpoint
evaluation state
metrics
```

The runtime must survive process interruption where practical.

---

# 24. EXECUTION BUDGETS

Support:

```json
{
  "maxIterations": 100,
  "maxToolCalls": 300,
  "maxExecutionTimeSeconds": 3600,
  "maxTokens": 200000,
  "maxFilesChanged": 100
}
```

When limits are reached:

- stop safely
- persist state
- explain why
- allow resume if possible

---

# 25. PAUSE / RESUME

CLI:

```bash
harness run ...
harness status <run-id>
harness pause <run-id>
harness resume <run-id>
harness cancel <run-id>
```

A resumed task should restore its state rather than starting from zero.

---

# 26. STALL DETECTION

Track:

```text
last model response
last tool execution
last state change
current iteration
current tool
elapsed time
```

Detect:

- model timeout
- tool timeout
- repeated tool calls
- repeated failures
- no progress
- infinite loops

---

# 27. SNAPSHOT SYSTEM

Implement workspace snapshots.

Suggested:

```text
src/snapshots/

    snapshotManager.ts
    snapshotStore.ts
    rollback.ts
    diff.ts
```

Prefer Git-based snapshots for Git repositories.

Snapshots should capture enough information to restore workspace state.

Example:

```text
Task Start
    ↓
Snapshot A
    ↓
Agent changes
    ↓
Snapshot B
    ↓
Tests
    ↓
Snapshot C
    ↓
Further changes
    ↓
Failure
    ↓
Rollback to Snapshot B
```

Avoid including:

```text
node_modules
.git internals unnecessarily
large build artifacts
secrets
```

---

# 28. CHECKPOINTS

A checkpoint should include:

```text
workspace snapshot
conversation state
task state
plan
evaluation state
metrics
```

Checkpoints should be created:

- before major changes
- after successful verification
- before risky operations
- before recovery
- at configurable intervals

---

# 29. RECOVERY ENGINE

Create:

```text
src/recovery/

    recoveryEngine.ts
    failureClassifier.ts

    strategies/
        retry.ts
        inspect.ts
        replan.ts
        rollback.ts
        askUser.ts
        abort.ts
```

Failure classes:

```text
MODEL_FAILURE
TOOL_FAILURE
TIMEOUT
TEST_FAILURE
TYPECHECK_FAILURE
BUILD_FAILURE
POLICY_BLOCK
STALL
REPEATED_FAILURE
BUDGET_EXCEEDED
```

Possible responses:

```text
RETRY
INSPECT
REPLAN
ROLLBACK
REDUCE_SCOPE
SPAWN_SUBAGENT
ASK_USER
ABORT
```

Never retry the same failed operation indefinitely.

---

# 30. LOOP DETECTION

Detect repeated behavior.

Example:

```text
read_file
edit_file
test
same failure
read_file
edit_file
test
same failure
```

After a threshold:

```text
REPEATED FAILURE DETECTED
```

Trigger recovery.

---

# 31. OBSERVABILITY

Emit structured events:

```text
run.started
plan.created
model.request
model.response
tool.request
tool.result
guardrail.checked
guardrail.blocked
snapshot.created
snapshot.restored
evaluation.started
evaluation.completed
recovery.started
recovery.completed
run.paused
run.resumed
run.completed
run.failed
```

The Agent should emit events without knowing how they are stored or displayed.

---

# 32. RUN REPLAY

Persist enough information to inspect an execution.

Store:

```text
run ID
task
model
configuration
tool calls
tool results
guardrail decisions
snapshots
evaluation results
recovery actions
metrics
```

Provide:

```bash
harness replay <run-id>
```

The replay should show:

```text
Task
 ↓
Plan
 ↓
Tool Call
 ↓
Tool Result
 ↓
State Change
 ↓
Verification
 ↓
Failure
 ↓
Recovery
 ↓
Success
```

---

# 33. CLI

Implement:

```bash
harness run

harness run --sandbox

harness run --eval AUTH-001

harness eval list

harness eval run coding-harness-v1

harness eval report <run-id>

harness status <run-id>

harness pause <run-id>

harness resume <run-id>

harness cancel <run-id>

harness snapshot create

harness snapshot list

harness snapshot restore <id>

harness mcp list

harness mcp tools

harness replay <run-id>
```

Follow the existing CLI architecture instead of rewriting it.

---

# 34. REQUIRED TESTS

Do not consider this work complete without automated tests.

## Unit tests

Test:

- evaluator registry
- task loader
- test evaluator
- typecheck evaluator
- build evaluator
- requirement evaluator
- diff evaluator
- security evaluator
- policy engine
- command classification
- path sandbox
- secret scanner
- MCP adapter
- snapshot creation
- snapshot restoration
- budget enforcement
- stall detection
- loop detection
- failure classification
- recovery strategies

## Integration tests

Test:

### Test 1

Agent modifies repository.

Evaluation detects success.

### Test 2

Agent introduces a bug.

Tests fail.

Recovery is triggered.

Agent fixes bug.

Evaluation passes.

### Test 3

Agent attempts dangerous command.

Guardrail blocks it.

Agent continues safely.

### Test 4

MCP tool is discovered.

Agent invokes MCP tool.

Guardrail evaluates it.

Tool executes successfully.

### Test 5

Long-running task pauses.

State is persisted.

Task resumes.

Execution continues.

### Test 6

Snapshot is created.

Agent makes destructive changes.

Snapshot is restored.

Workspace returns to expected state.

### Test 7

Agent enters repeated failure loop.

Loop detector activates.

Recovery strategy executes.

### Test 8

Budget is exceeded.

Runtime stops safely.

State remains resumable.

---

# 35. END-TO-END DEMONSTRATION

Create one polished reproducible demo.

Example task:

> Fix a broken authentication implementation and add proper tests.

The demonstration should show:

```text
1. User gives task
       ↓
2. Agent creates plan
       ↓
3. Snapshot created
       ↓
4. Agent explores repository
       ↓
5. Agent uses normal tools
       ↓
6. Agent uses an MCP tool
       ↓
7. Agent modifies code
       ↓
8. Tests fail
       ↓
9. Failure classified
       ↓
10. Agent recovers
       ↓
11. Guardrail blocks unsafe operation
       ↓
12. Agent continues
       ↓
13. Tests pass
       ↓
14. Typecheck passes
       ↓
15. Security evaluation passes
       ↓
16. Requirement evaluation passes
       ↓
17. Final verified report
```

This should become the primary project demonstration.

---

# 36. EVALUATION OF THE HARNESS ITSELF

The benchmark must not only evaluate coding agents.

It must evaluate whether Coding-Harness features actually improve reliability.

Run ablation experiments:

```text
Experiment A:
Baseline Agent

Experiment B:
Baseline + Verification

Experiment C:
Baseline + Verification + Guardrails

Experiment D:
Baseline + Verification + Recovery

Experiment E:
Baseline + Verification + Recovery + Snapshots

Experiment F:
Full Coding-Harness
```

Compare:

```text
Task Success Rate
Test Pass Rate
Recovery Success
Regression Rate
Average Tool Calls
Average Iterations
Token Usage
Execution Time
Guardrail Violations
Rollback Frequency
```

The benchmark should make it possible to determine whether each feature provides measurable value.

---

# 37. REPRODUCIBILITY

Every evaluation run must record:

```text
Harness version
Dataset version
Task version
Evaluator version
Model
Model version
Model configuration
System prompt hash
Workspace initial state
Environment
Tool configuration
MCP configuration
Budget configuration
```

A benchmark result without this metadata is incomplete.

---

# 38. FINAL SUCCESS CRITERIA

The implementation is considered complete only when:

## Evaluation

- [ ] Evaluation engine exists
- [ ] Task format exists
- [ ] Dataset v1 exists
- [ ] At least 30 useful tasks exist
- [ ] Target is eventually 50 tasks
- [ ] Hidden tests exist
- [ ] Deterministic evaluators work
- [ ] Evaluation reports work
- [ ] Benchmark runner works

## Guardrails

- [ ] Tool policies
- [ ] Command policies
- [ ] Path sandboxing
- [ ] Secret detection
- [ ] Resource limits
- [ ] MCP tools pass through guardrails

## MCP

- [ ] MCP server configuration
- [ ] Tool discovery
- [ ] Tool execution
- [ ] Failure handling
- [ ] Timeout
- [ ] Reconnect

## Long-running tasks

- [ ] Persistent state
- [ ] Pause
- [ ] Resume
- [ ] Cancel
- [ ] Heartbeat
- [ ] Stall detection
- [ ] Budgets

## Snapshots

- [ ] Snapshot creation
- [ ] Snapshot listing
- [ ] Restore
- [ ] Checkpoints
- [ ] Recovery integration

## Recovery

- [ ] Failure classification
- [ ] Retry
- [ ] Replan
- [ ] Rollback
- [ ] Loop detection
- [ ] Recovery limits

## Observability

- [ ] Structured events
- [ ] Run metadata
- [ ] Run replay
- [ ] Evaluation report

## Testing

- [ ] Unit tests
- [ ] Integration tests
- [ ] End-to-end benchmark
- [ ] Security tests
- [ ] Failure/recovery tests

---

# 39. FINAL DOCUMENTATION

After implementation update:

```text
README.md
ARCHITECTURE.md
EVALS.md
GUARDRAILS.md
MCP.md
LONG_RUNNING_TASKS.md
SNAPSHOTS.md
RECOVERY.md
```

The documentation should explain:

1. What Coding-Harness is
2. Why it exists
3. Architecture
4. Agent lifecycle
5. Evaluation system
6. Dataset design
7. Guardrails
8. MCP integration
9. Long-running execution
10. Snapshots
11. Recovery
12. Reproducibility
13. Benchmarking
14. How developers extend it
15. How to run the demo

---

# FINAL PRINCIPLE

Coding-Harness should evolve from:

```text
LLM
 ↓
Tools
 ↓
Code Changes
```

into:

```text
             CODING-HARNESS

Task
 ↓
Planning
 ↓
Autonomous Execution
 ↓
Tools + MCP
 ↓
Guardrails
 ↓
Snapshots
 ↓
Verification
 ↓
Evaluation
 ↓
Recovery
 ↓
Re-verification
 ↓
Verified Result
```

The most important invariant is:

> **The agent is responsible for attempting the task. The harness is responsible for proving whether the task succeeded.**

Build toward that principle throughout the entire implementation.