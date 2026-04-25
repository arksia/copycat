import type { EditorKind } from './editor-adapter';

export function buildCompletionSignalKey(host: string, editorKind: EditorKind): string {
  return `${host}::${editorKind}`;
}

export function buildCompletionFingerprint(args: {
  host: string;
  editorKind: EditorKind;
  prefix: string;
  suffix?: string;
}): string {
  return [
    buildCompletionSignalKey(args.host, args.editorKind),
    args.prefix,
    args.suffix ?? '',
  ].join('\u241f');
}
