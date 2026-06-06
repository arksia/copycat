---
name: copycat-docs-authoring
description: >
  Use when writing or updating Copycat product specs, implementation plans, decision notes, or process docs.
  Not for runtime code changes or trivial notes that are better handled in the final response.
  Output: a clear doc with status, scope, decisions, acceptance checks, and affected surfaces.
---

# Copycat Docs Authoring

Use this skill when a task needs durable product or development context that future agents should be able to recover.

## Overview

Copycat documentation should be lightweight, explicit, and easy to trace back to implementation decisions.

## Workflow

1. Identify the artifact type.
   Product model or feature design belongs in `docs/superpowers/specs/`. Implementation sequencing belongs in `docs/superpowers/plans/`. Durable architecture or process decisions belong in `docs/decisions/` if that directory exists; otherwise use a short note under `docs/`.

2. Start with source-of-truth status.
   State whether the document is current, historical, draft, or superseded. If it overrides older docs, name that explicitly.

3. Capture the decision shape.
   Write the goal, non-goals, product rules, rejected alternatives, acceptance checks, and affected code surfaces.

4. Separate behavior from implementation steps.
   Product docs define behavior and boundaries. Code-level step lists belong in implementation plans.

5. Keep the document maintainable.
   Prefer short sections, direct language, concrete paths, and explicit tradeoffs over broad templates.

## Required Shape

Use this shape for product or decision docs unless a smaller note is enough:

```markdown
# Title

## Status
## Goal
## Non-Goals
## Current Model
## Decisions
## Rejected Alternatives
## Acceptance Checks
## Implementation Notes
```

## Common Mistakes

| Mistake | Result | Fix |
| --- | --- | --- |
| Writing a long plan as a spec | Reviewers cannot tell what behavior is intended | Split product model from implementation steps |
| Leaving old docs unqualified | Conflicting docs become impossible to route | Add status and supersession notes |
| Copying broad templates | The doc becomes hard to maintain | Keep only sections that carry project context |

## Next Step

After the doc is updated, use `copycat-development-flow` for planning implementation or `copycat-quality-gate` before delivery.
