---
name: copycat-quality-gate
description: >
  Use before claiming a Copycat change is complete, before committing substantial work, or before review.
  Not for initial planning or product discussion.
  Output: scope check, requirement alignment, verification evidence, and residual risks.
---

# Copycat Quality Gate

No completion claim without fresh verification from the current patch.

## Gate Steps

1. Scope check.
   Confirm the diff only contains files explained by the request. Do not hide unrelated cleanup in the patch.

2. Requirement check.
   Compare the implementation against the user request, `AGENTS.md`, and any relevant spec/plan.

3. Contract check.
   Runtime messages, storage payloads, settings, prompt layers, and network request shapes must be explicit and covered by focused tests when changed.

4. UI check.
   For Vue/entrypoint UI changes, verify state is understandable and no obsolete controls remain.

5. Fresh verification.
   Run the required commands for this patch and read the output.

## Required Commands

Always run:

```bash
pnpm test
pnpm compile
```

Also run:

```bash
pnpm build
```

when changing extension entrypoints, WXT config, manifest-related config, runtime wiring, or packaged behavior.

Use targeted tests while iterating, but final claims require the full required checks above.

## Completion Report

Report:

- Main behavior change.
- Important files or contracts touched.
- Verification commands and result.
- Known warnings or residual risks.

Do not say "complete", "fixed", or "ready" unless the required commands were rerun after the final patch.

## Common Mistakes

| Mistake | Result | Fix |
| --- | --- | --- |
| Reporting expected checks instead of fresh output | Completion claim is not verifiable | Run the commands after the final patch and read the output |
| Ignoring docs-only scope | Documentation can still create wrong project conventions | Check stale references and outdated claims |
| Hiding unrelated cleanup | Review becomes harder and riskier | Keep unrelated findings out of the diff |
