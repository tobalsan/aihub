---
description: Study the codebase, plan a multi-pass review, then run it in fresh Ralph sessions
argument-hint: "[scope, comparison range, or review goals]"
---
Perform a thorough, evidence-based code review and improvement pass on this repository using a fresh-context Ralph Wiggum loop.

Optional review context from the user:

`${ARGUMENTS:-No extra scope was supplied. Perform a complete review of the entire codebase. Cover every major ownership area over multiple passes, including correctness, module depth and interfaces, dependency direction and cycles, complexity, duplication, testability and test gaps, type and lint debt, documentation locality and size (including docs/llms.md), maintainability, and AI navigability. Recent changes are context, not the default scope.}`

Before starting the loop:

1. Read and follow these skills completely:
   - `/improve-codebase-architecture`
   - `/refactor`
   - `/simplify-code`
   - `/pi-ralph-wiggum`
2. Study the repository and its instructions, architecture docs, current git state, relevant history/diffs, tests, and major ownership boundaries. If a comparison range or narrower scope was supplied, inspect it explicitly and let it override the default whole-codebase scope. Do not prescribe fixes before tracing the relevant code paths and gathering direct evidence.
3. For the default whole-codebase review, inventory every major ownership area and give each meaningful area one or more dedicated passes. Audit repository-wide dependency direction/cycles, module depth and interfaces, complexity and duplication, type/lint debt, testability and test gaps, documentation structure/locality/size (explicitly including `docs/llms.md`), maintainability, and AI navigability. Do not infer architectural quality from a green test suite.
4. Produce a prioritized findings inventory. Separate confirmed facts, inferences, and unknowns. Reject speculative or cosmetic work that does not materially improve correctness, architecture, maintainability, testability, or AI navigability.
5. Convert accepted findings into a durable, ordered Ralph checklist. Each item must be small enough for one fresh session, identify its evidence and affected area, state concrete acceptance criteria, and name the smallest relevant verification. Preserve behavior unless a confirmed bug requires a behavior change.
6. Include final checklist items for cross-cutting architecture review, repository-wide dependency/cycle analysis, complexity and test-gap review, documentation review, formatting/linting/type checking, builds, and the full repository test suite. Require `CHANGELOG.md` updates for user-visible changes. Do not commit unless explicitly requested.

Then call `ralph_start` with a descriptive loop name, the complete task file, and `maxIterations: 50`. Configure the loop so every iteration:

- reads repository instructions and the durable Ralph files;
- handles exactly one checklist item, or one tightly coupled bounded batch;
- applies the three review skills where relevant;
- makes surgical changes only, with tests for bugs or behavior changes;
- records evidence, decisions, commands, outcomes, and remaining risks in the durable task/reflection files;
- runs the listed focused verification before marking an item complete;
- never skips or suppresses failing tests, lint, or type checks;
- revises or removes a planned change if deeper inspection shows it is unjustified;
- emits `<promise>COMPLETE</promise>` only after every checklist item and final verification pass succeeds.

Default to the full 50-iteration budget for a no-argument whole-codebase review. Do not collapse ownership areas into a single session merely to finish early; each major area should receive dedicated investigation and, where findings justify it, separate implementation and verification passes. After starting the loop, report only the loop name, where its durable files live, and its current status.
