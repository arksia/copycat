import type { EditorKind } from '../editor-adapter'

/**
 * Builds the shared cancellation key for one host/editor request channel.
 *
 * Before:
 * - `host = "chatgpt.com"`, `editorKind = "textarea"`
 *
 * After:
 * - `"chatgpt.com::textarea"`
 */
export function buildCompletionSignalKey(host: string, editorKind: EditorKind): string {
  return `${host}::${editorKind}`
}

/**
 * Builds a stable fingerprint for deduplicating completion requests.
 *
 * Before:
 * - `{ host: "playground", editorKind: "textarea", prefix: "hello", suffix: "" }`
 *
 * After:
 * - `"playground::textarea␟hello␟"`
 */
export function buildCompletionFingerprint(args: {
  host: string
  editorKind: EditorKind
  prefix: string
  suffix?: string
}): string {
  return [
    buildCompletionSignalKey(args.host, args.editorKind),
    args.prefix,
    args.suffix ?? '',
  ].join('\u241F')
}
