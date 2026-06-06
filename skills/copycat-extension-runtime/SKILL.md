---
name: copycat-extension-runtime
description: >
  Use when editing Copycat browser extension runtime surfaces, message contracts, storage contracts, or packaged behavior.
  Not for pure documentation work or product discussion without implementation.
  Output: runtime-safe implementation with focused tests and required build checks.
---

# Copycat Extension Runtime

Use this skill to keep extension changes safe across browser surfaces.

## Runtime Surfaces

- `entrypoints/background.ts`: RPC routing, cancellation, settings, knowledge, Soul event persistence.
- `utils/completion/background.ts`: completion orchestration, cache, telemetry, knowledge, Soul projection.
- `entrypoints/content.ts`: editor detection, trigger lifecycle, overlay, completion events.
- `entrypoints/options/App.vue`: durable settings UI.
- `entrypoints/popup/App.vue`: lightweight toggle and shortcuts.
- `entrypoints/playground/App.vue`: isolated validation/debug surface.
- `types/index.ts`: runtime messages and storage-facing contracts.
- `utils/storage/`: IndexedDB schema and repositories.

## Change Discipline

1. Identify the boundary.
   Runtime message shape, storage shape, network request shape, and prompt shape must remain explicit.

2. Keep the autocomplete path simple.
   Build prompt → send one OpenAI-compatible request → sanitize continuation.

3. Preserve cancellation semantics.
   If changing request IDs, signal keys, debounce, or staged completions, inspect both content and background flow.

4. Keep options links direct.
   Extension surfaces should open `options.html` directly for settings.

5. Update contracts with tests.
   Any message, storage, prompt, threshold, or setting change needs focused Vitest coverage.

## Browser/UI Validation

- Use playground for completion-flow validation.
- For known local extension pages, inspect options/popup/playground after meaningful UI changes.
- For packaged runtime changes, run `pnpm build`.

## Required Verification

- Always run `pnpm test`.
- Always run `pnpm compile`.
- Run `pnpm build` when touching entrypoints, WXT config, manifest-affecting wiring, or packaged runtime behavior.

Report any existing third-party build warnings separately from failures.

## Common Mistakes

| Mistake | Result | Fix |
| --- | --- | --- |
| Changing runtime messages without updating tests | Background and content surfaces drift | Update contracts and focused Vitest coverage together |
| Treating playground debug as normal UX | Options UI becomes too complex | Keep debug visibility in playground unless product docs say otherwise |
| Skipping build after entrypoint changes | Packaged extension breakage is missed | Run `pnpm build` for entrypoint or manifest-affecting changes |
