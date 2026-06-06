---
name: copycat-development-flow
description: >
  Use for non-trivial Copycat development planning, feature shaping, decision capture, or implementation sequencing.
  Not for trivial one-line fixes or already-scoped edits.
  Output: finish line, acceptance checks, scope, testing plan, and decision notes.
---

# Copycat Development Flow

Use this skill to keep Copycat development lightweight but traceable.

## Workflow

1. Build local context first.
   Read `AGENTS.md`, the touched runtime surface, focused tests, and any relevant files under `docs/` or `docs/superpowers/`.

2. Define the finish line.
   State one sentence for the desired outcome, concrete acceptance checks, and what is intentionally out of scope.

3. Choose documentation weight.
   - Trivial change: no separate doc; explain assumptions in the final response.
   - Small behavior change: add or update focused tests; mention the decision in the PR/commit summary.
   - Multi-step or product-shaping work: create or update `docs/superpowers/specs/YYYY-MM-DD-topic.md` or `docs/superpowers/plans/YYYY-MM-DD-topic.md`.
   - Durable architecture/process decision: create or update `docs/decisions/` if that directory exists; otherwise add a short decision note under `docs/`.

4. Plan in straight lines.
   Every step should move toward the final behavior without throwaway scaffolding. If a step cannot be tested or demonstrated, rewrite it or mark it as a time-boxed spike.

5. Keep implementation surgical.
   Touch only files required by the finish line. If an adjacent cleanup is tempting, record it separately unless it directly removes obsolete code from the same patch.

## Required Plan Shape

For non-trivial work, write or state:

```markdown
Goal:
Acceptance checks:
Out of scope:
Files likely touched:
Testing plan:
Decision notes:
```

## Documentation Rules

- Preserve `AGENTS.md` as the high-level contributor guide.
- Use `docs/superpowers/specs/` for product/design notes.
- Use `docs/superpowers/plans/` for implementation plans.
- Prefer short decision records over long templates.
- When a discussion changes project conventions, update docs in the same task.

## Common Mistakes

| Mistake | Result | Fix |
| --- | --- | --- |
| Starting implementation before defining the finish line | Scope drifts into adjacent cleanup | Write goal, acceptance checks, and out-of-scope first |
| Writing a plan with unverifiable steps | Progress cannot be reviewed | Attach tests, compile checks, or a clear manual validation point |

## Handoff

Before finishing, report:

- What changed.
- Why this shape was chosen.
- What was verified with fresh command output.
- Any follow-up that was intentionally not included.
