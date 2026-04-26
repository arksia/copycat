# AGENTS.md

Contributor guide for `copycat`.

This file is meant to be used as an execution guide, not as a loose preference list. Keep changes small, explicit, and provider-agnostic.

## Project Context

- `copycat` is a browser extension built with WXT, Vue 3, and TypeScript.
- The current product focus is remote OpenAI-compatible autocomplete.
- The main runtime surfaces are:
  - `entrypoints/background.ts`: request orchestration, caching, cancellation, settings RPC.
  - `entrypoints/content.ts`: site integration and injection lifecycle.
  - `entrypoints/options/App.vue`: settings UI.
  - `entrypoints/popup/App.vue`: lightweight toggle and shortcuts UI.
  - `entrypoints/playground/App.vue`: isolated textarea playground for completion flow validation.
  - `utils/`: core logic, request building, sanitization, settings, adapters.
  - `types/`: shared runtime and storage-facing contracts.
  - `tests/`: focused Vitest coverage for utils and core flows.

## 1. Think Before Coding

- State assumptions when they matter.
- If multiple interpretations exist, surface them instead of silently picking one.
- If a simpler solution exists, prefer it and say so.
- If something is unclear, stop and clarify rather than coding through ambiguity.

For multi-step tasks, define the success condition first:

1. Change the smallest relevant implementation unit.
2. Verify with the narrowest useful check.
3. Expand verification only when the touched surface requires it.

## 2. Simplicity First

- Implement only what the request requires.
- Do not add speculative abstractions, fallback layers, toggles, or configurability.
- Do not preserve half-finished experiments behind flags unless explicitly requested.
- Do not add provider-specific, host-specific, or model-specific branches unless the product requirement clearly calls for them.
- If the same outcome can be achieved with less code and fewer moving parts, choose that version.

Ask before merging complexity into the codebase:

- Is this solving a real requirement now
- Is this branch understandable by the next contributor in one read
- Would a senior engineer consider this obviously necessary

If the answer is no, simplify.

## 3. Surgical Changes

- Touch only files directly related to the task.
- Do not refactor adjacent code just because you noticed it.
- Do not "clean up" unrelated comments, formatting, or dead code.
- If your change makes imports, code paths, tests, or UI state obsolete, remove them in the same patch.
- If you discover unrelated issues, mention them separately instead of folding them into the current diff.

Every changed line should be explainable by the request or by a small progressive refactor that clearly improves the touched code.

## 4. Goal-Driven Execution

Translate requests into verifiable outcomes:

- "Fix autocomplete behavior" means reproduce or define the behavior, patch it, then verify it.
- "Clean provider logic" means remove the branch or field, then verify the request path still works.
- "Review and normalize code" means identify the rule, apply it consistently within scope, then rerun the relevant checks.

Preferred loop:

1. Reproduce or inspect the current behavior.
2. Make the smallest change that should fix it.
3. Verify immediately.
4. Only then continue to adjacent cleanup.

## 5. Project-Specific Rules

### Provider and Model Handling

- Keep request construction OpenAI-compatible and generic by default.
- Do not commit personal endpoints, models, API keys, or user-specific presets.
- Avoid custom request fields such as host-specific reasoning controls unless explicitly requested and documented.
- Do not add silent retries that materially change request semantics unless the product requirement explicitly needs them.
- If a model or provider requires special handling, isolate that decision and document why it exists.

### Settings and Runtime Boundaries

- Settings defaults must be neutral, understandable, and safe for a new contributor.
- Storage payloads, runtime messages, and network request shapes must remain explicit and easy to inspect.
- Prefer opening `options.html` directly when linking to settings from extension surfaces.
- Keep the main autocomplete path simple:
  - build prompt
  - send one OpenAI-compatible request
  - sanitize the returned continuation

### Progressive Refactor Policy

- Small progressive refactors are encouraged when they directly improve the touched code.
- Do not add backward-compatibility guards unless extended support is explicitly required.
- If extended support would significantly complicate the patch, stop and document the refactor shape instead of layering hacks.

## 6. Code Style

### General

- For TypeScript and Vue `<script lang="ts">`, use the existing no-semicolon style.
- Match the surrounding file style before introducing a new pattern.
- Prefer `const` by default. Use `let` only when reassignment is required.
- Prefer early returns over nested condition trees.
- Keep happy-path logic visually dominant.
- Avoid dense one-liners when a few explicit lines are easier to read.
- Keep functions short and direct. Do not add wrappers or indirection without a real reuse point.

### Naming

- Use names that describe domain meaning, not temporary implementation details.
- Prefer full words over abbreviations unless the abbreviation is already standard in that file.
- Boolean names should read like booleans: `is*`, `has*`, `can*`, `should*`.
- Collections use plural names. Singular values do not.

### Comments

- Comments should be concise and useful.
- Explain intent, constraints, or non-obvious behavior.
- Do not add comments that merely restate the code.
- Keep existing useful comments when moving code.
- When a workaround is necessary, add a `// NOTICE:` comment that explains:
  - why it exists
  - what the root cause is
  - when it can be removed

Useful markers:

- `// TODO:` follow-up work
- `// REVIEW:` needs confirmation or another pass
- `// NOTICE:` workaround, magic behavior, or external constraint

## 7. TypeScript Regulations

- Do not use `any`.
- Prefer generics, narrow interfaces, discriminated unions, and local type narrowing.
- If a boundary is uncertain, model it as `unknown` and narrow it intentionally.
- Use `as unknown as TargetType` only when a safer option is not practical and keep that cast local.
- Prefer `interface` for exported object-shaped contracts that may evolve.
- Prefer `type` for unions, literals, mapped types, and utility compositions.
- Keep runtime-facing contracts explicit:
  - storage objects
  - runtime messages
  - fetch payloads
  - parsed response shapes

For new or substantially changed exported utilities, add JSDoc when the behavior is not obvious. At minimum, document:

- what it does
- when to use it
- key input assumptions
- return guarantees

For normalizers or sanitizers, document before/after behavior when the transformation is non-trivial.

## 8. Vue and UI Rules

- Prefer `script setup`.
- Keep reactive state close to where it is consumed.
- Keep computed values pure.
- Keep watchers small and intentional. If a computed value or direct event flow is clearer, use that instead.
- Do not hide business logic inside template expressions.
- Prefer explicit handler functions once template logic stops being trivial.
- Match the existing component and template style inside the touched file instead of rewriting style conventions opportunistically.

## 9. Error Handling

- Error messages that can surface to users should be actionable.
- Prefer precise messages over generic "failed" wording when the cause is known.
- Do not swallow errors unless the failure is intentionally non-critical.
- If falling back from one behavior to another, make sure that fallback is explicit, justified, and observable in code.

## 10. Testing Expectations

- Use focused Vitest coverage for behavior changes when feasible.
- For bugs, reproduce the issue with a test first when the reproduction cost is reasonable.
- Test behavior, not implementation trivia.
- Keep fixtures neutral and portable. Use values such as `https://example.com/v1` and `test-model`.
- When changing normalization rules, prompt builders, message shapes, or request thresholds, update the focused tests in the same patch.
- Prefer targeted test runs while iterating, then run the required final verification.

Required verification:

- Always run:
  - `pnpm test`
  - `pnpm compile`
- Also run `pnpm build` when changing:
  - extension entrypoints
  - manifest-related config
  - WXT config
  - wiring that affects packaged runtime behavior

Do not claim a fix is complete without fresh verification results from the current patch.

## 11. Review Checklist

Before finishing, verify:

- no user-specific defaults remain
- no dead experimental wiring remains in UI or background flows
- no provider/model/host hacks were introduced without explicit need
- changed code matches file-local style, including no-semicolon TypeScript
- types remain explicit across storage, runtime messaging, and network boundaries
- tests and compile checks were actually rerun

## 12. Documentation Expectations

- Keep `AGENTS.md` aligned with how the repository is actually being developed.
- Do not copy broad template rules blindly if they do not fit this repo.
- When project conventions change, update this file in the same task or immediately after.
