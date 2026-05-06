# Copycat

> Your portable project memory for any AI chat.

Copycat is a browser extension that brings **Cursor Tab–style ghost-text
autocomplete** into any AI chat window on the web — ChatGPT, Claude, Gemini,
DeepSeek, Kimi, Poe, and your own internal agents. You press `Tab` to accept a
suggestion, `Esc` to dismiss. In later phases, the suggestions become
**grounded in your own knowledge base** (docs you upload once, available
everywhere).

```
┌─────────────────────────────────────────────────────────────┐
│ ChatGPT / Claude / Gemini / your agent …                    │
│                                                             │
│   I'd like to propose adding a new endpoint ▮               │
│   ───────────────────────────────────────────               │
│    for tenant-scoped user lookups, consistent               │  ← ghost text
│    with OrderService's auth pattern.                        │   (Tab to accept)
└─────────────────────────────────────────────────────────────┘
```

## What's different

| | Grammarly / Compose AI | pc9350/ai-autocomplete | **Copycat** |
|---|---|---|---|
| Works inside AI chat inputs | partial | yes | yes |
| Uses **your** docs for grounding | no | no | **yes (RAG)** |
| Multiple project knowledge bases | no | no | **yes** |
| Pick your own LLM backend | no | Gemini Nano only | **Groq / OpenAI / DeepSeek / Ollama / custom** |
| Staged completion orchestration | no | no | **yes** |

## Status

Current progress is best described as **Phase 3 in progress**:

- ✅ Manifest V3 + WXT + Vue 3 + TypeScript baseline
- ✅ Remote OpenAI-compatible completion path (Groq / OpenAI / DeepSeek / Ollama / custom)
- ✅ Ghost-text autocomplete for native `<textarea>` / `<input>` surfaces
- ✅ Tab accept, Esc dismiss, typing-through-suggestion, IME-safe request suppression
- ✅ Options UI, popup toggle, playground, model discovery, debug preview
- ✅ IndexedDB local completion cache, telemetry store, and knowledge document storage
- ✅ Markdown knowledge import, chunking, local embeddings, semantic-first retrieval, and prompt packing
- ✅ Single-profile Soul layer with prompt injection, settings editing, and playground debug visibility
- ✅ Extensible editor adapter layer, with current delivery priority on native text inputs
- ✅ Staged completion flow plus local telemetry-driven retrieval budget tuning
- ✅ Document-level semantic recall on top of chunk-level semantic rerank
- ⏳ Phase 1b — ProseMirror / richer editor adapter with CSS Highlight API-style native rendering
- ⏳ Phase 3 — Soul / Prompt Skills / stronger semantic retrieval and grounding quality
- ⏳ Phase 4 — WebGPU local inference as the default completion path

Phase 3 retrieval follow-ups already identified:

- versioned query embedding cache
- versioned document recall cache

See the [Design Doc](#design-notes) at the bottom for details.

## Getting started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

### Install & run (development)

```bash
pnpm install
pnpm dev          # launches Chrome with the extension auto-reloaded
# pnpm dev:firefox
```

### Build a distributable zip

```bash
pnpm build
pnpm zip          # -> .output/copycat-<version>-chrome.zip
```

### Configure

After the extension loads:

1. The options page opens automatically on first install.
2. Pick a **provider** — Groq is recommended for lowest latency.
3. Paste your API key.
4. Click **Test connection** — you should see `Connected — reply: ok`.
5. Open ChatGPT / Claude / Gemini, start typing, watch the ghost text appear.

> On ChatGPT and Claude, richer editors still rely on the generic overlay path.
> Native `<textarea>` / `<input>` is the current primary target, while the
> dedicated ProseMirror adapter remains a follow-up milestone. See
> `utils/editor-adapter.ts`.

## Project layout

```
copycat/
├── entrypoints/
│   ├── background.ts       # MV3 service worker — LLM request broker
│   ├── content.ts          # Content script — input hijacking & orchestration
│   ├── offscreen/          # Knowledge import worker surface
│   ├── options/            # Vue 3 options page
│   ├── playground/         # Isolated completion playground
│   └── popup/              # Vue 3 toolbar popup
├── utils/
│   ├── completion/         # Completion cache, client, staging, telemetry, debug
│   ├── core/               # Shared base/runtime helpers
│   ├── db/                 # IndexedDB schema and repositories
│   ├── knowledge/          # Import, normalize, chunk, retrieve, prompt packing
│   ├── editor-adapter.ts   # textarea / input / contenteditable adapters
│   ├── ghost-text.ts       # Overlay renderer + playground sync
│   ├── knowledge-budget.ts # Retrieval budget tuning from telemetry quality
│   ├── openai-compatible.ts# OpenAI-compatible host helpers
│   ├── providers.ts        # Groq / OpenAI / DeepSeek / Ollama presets
│   └── settings.ts         # chrome.storage.local schema & helpers
├── types/index.ts          # Shared types
├── assets/tailwind.css     # Styles
├── wxt.config.ts           # Manifest + build config
└── tailwind.config.js
```

## Design notes

### Why an overlay, not DOM insertion?

ChatGPT and Claude use ProseMirror, whose internal state reconciles any direct
DOM mutation we make — ghost text inserted into the editor gets reverted on
the next keystroke. The Phase 0 approach sidesteps this entirely by rendering
a `position: fixed` overlay pinned to the measured caret rect. Phase 1 will
add a native ProseMirror adapter using the
[CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API),
which lets us style "ghost" regions without touching the DOM tree.

### IME safety (中文输入法)

The content script tracks `compositionstart` / `compositionend`. While the
user is composing pinyin, we suppress completion requests and hide any
outstanding suggestion — otherwise the composition candidates and our ghost
text fight for the same screen region and wreck the experience.

### Acceptance by typing-through

If you keep typing and your characters match the start of the suggestion, the
overlay simply trims itself rather than dismissing. This is the same
behaviour Cursor Tab uses and it keeps the suggestion from feeling
"all-or-nothing".

### Privacy

- The API key is stored in `chrome.storage.local` on your machine only.
- Prompts are sent directly from your browser to the endpoint **you**
  configure. No Copycat-operated server sits in the middle.
- Ollama mode (`http://localhost:11434/v1`) keeps everything on-device.

## Roadmap

See [`docs/roadmap.md`](./docs/roadmap.md) for the full
plan. Short version:

1. **Phase 1b** — ProseMirror + richer editor adapter, with more native ghost-text rendering.
2. **Phase 3** — Soul / Prompt Skills, plus remaining retrieval follow-ups such as versioned query/document recall caches.
4. **Phase 4** — WebGPU on-device inference, with remote mode retained as an explicit fallback choice.

## License

MIT — see [LICENSE](./LICENSE).
