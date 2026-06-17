# Soul Core Architecture

## Status

Accepted on 2026-06-17.

This note records the architecture decision from the Soul architecture review.
It supersedes older Soul notes when they describe Soul as an auxiliary prompt feature.

## Decision

Copycat's primary product path is inline autocomplete.

Soul is also a core product capability, but it supports that path as an independent domain, not as hidden logic inside completion.
Knowledge/RAG is a completion quality enhancer and should not become a competing product axis.

## Product Model

- Completion is the main runtime path.
- Soul is a signature core selling point.
- `settings.soul.text` is the only source of truth for runtime Soul.
- Soul learning is automatic by default and can be disabled.
- When learning is disabled, `settings.soul.text` is fixed user intent.
- Soul should become a first-level product surface in UI, but UI changes are intentionally separate from this architecture extraction.

## Runtime Boundaries

Soul exposes two runtime-facing interfaces:

- Projection: turns the current editable Soul text into a completion-ready projection string plus metadata.
- Lifecycle: handles learning, export, scheduling, and log writing.

Completion consumes only the projection result.
It should not know how Soul learns, exports files, samples events, or records learning logs.

Background owns browser message and alarm routing.
Soul owns Soul lifecycle rules after background forwards the relevant event.

## Implementation Direction

The first implementation step is a low-risk architecture extraction:

- add a Soul runtime module under `soul/`
- move Soul learning scheduling and alarm handling out of `entrypoints/background.ts`
- keep behavior, thresholds, and runtime message contracts unchanged
- leave UI changes for a separate step

## Guardrails

- Do not introduce profile management, approval queues, or learned/manual layer split.
- Do not let learning bypass `settings.soul.text`.
- Do not move Knowledge into the same product level as Soul.
- Do not add new provider-specific request behavior while doing this extraction.
