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
| Two-stage speculative completion | no | no | planned |

## Status

This is **Phase 0** of the roadmap — a working skeleton:

- ✅ Manifest V3 + WXT + Vue 3 + TypeScript
- ✅ Ghost-text overlay for `<textarea>`, `<input>`, and `contenteditable`
- ✅ Tab to accept, Esc to dismiss, typing-through-suggestion, IME-safe
- ✅ OpenAI-compatible LLM client (Groq / OpenAI / DeepSeek / Ollama / custom)
- ✅ Options UI for backend, model, prompt, debounce, host allowlist
- ✅ Popup toggle (global / per-site)
- ⏳ Phase 1 — ProseMirror adapter (ChatGPT, Claude) via CSS Custom Highlight API
- ⏳ Phase 2 — On-device RAG with `transformers.js` + MeMemo + IndexedDB
- ⏳ Phase 3 — Two-stage speculative completion, LRU cache, accept/reject logs
- ⏳ Phase 4 — WebGPU local inference, DPO fine-tuning

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

> On ChatGPT and Claude, the editor is ProseMirror — Phase 0 renders a
> **floating overlay** positioned at the caret rather than inserting into the
> editor's DOM. It works, but the Phase 1 ProseMirror adapter will feel more
> native. See `utils/editor-adapter.ts`.

## Project layout

```
copycat/
├── entrypoints/
│   ├── background.ts       # MV3 service worker — LLM request broker
│   ├── content.ts          # Content script — input hijacking & orchestration
│   ├── options/            # Vue 3 options page
│   └── popup/              # Vue 3 toolbar popup
├── utils/
│   ├── editor-adapter.ts   # textarea / input / contenteditable adapters
│   ├── ghost-text.ts       # Floating overlay renderer
│   ├── llm.ts              # OpenAI-compatible client
│   ├── providers.ts        # Groq / OpenAI / DeepSeek / Ollama presets
│   ├── settings.ts         # chrome.storage.local schema & helpers
│   ├── debounce.ts
│   └── id.ts
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

See [`docs/roadmap.md`](./docs/roadmap.md) (created in Phase 1) for the full
plan. Short version:

1. **Phase 1** — ProseMirror + CSS Highlight API adapter; per-site profiles.
2. **Phase 2** — Local RAG via `transformers.js` embedding + MeMemo HNSW, with
   an Offscreen Document to dodge Service Worker sleep.
3. **Phase 3** — Two-stage speculative completion; LRU cache; accept/reject
   telemetry (local only, exportable).
4. **Phase 4** — WebGPU on-device inference; team-shared knowledge bases;
   slash-commands (`/api`, `/term`) for explicit retrieval.

## License

MIT — see [LICENSE](./LICENSE).
