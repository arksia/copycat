import type { KnowledgeSourceType } from '~/types'

/**
 * Parser input for imported knowledge content.
 *
 * Use when:
 * - a raw text-like document needs normalization before chunking
 * - the caller knows the source format but wants one plain-text output
 *
 * Expects:
 * - `rawContent` to contain the original textual payload
 *
 * Returns:
 * - the source type plus raw content to normalize
 */
export interface ParseKnowledgeDocumentArgs {
  rawContent: string
  sourceType: KnowledgeSourceType
}

/**
 * Converts imported text-like content into normalized plain text.
 *
 * Before:
 * - `"<h1>Title</h1><p>Hello</p>"`
 *
 * After:
 * - `"Title\n\nHello"`
 */
export function parseKnowledgeDocumentContent(
  args: ParseKnowledgeDocumentArgs,
): string {
  const content = args.rawContent.replace(/\r/g, '').trim()
  if (content.length === 0) {
    return ''
  }

  switch (args.sourceType) {
    case 'html':
      return normalizePlainText(extractHtmlText(content))

    case 'markdown':
      return normalizePlainText(stripMarkdownSyntax(content))

    case 'manual':
    case 'txt':
      return normalizePlainText(content)
  }
}

function extractHtmlText(content: string): string {
  const doc = new DOMParser().parseFromString(content, 'text/html')
  doc.querySelectorAll('script,style,noscript').forEach(node => node.remove())
  return doc.body.textContent ?? ''
}

function stripMarkdownSyntax(content: string): string {
  return content
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/^\s*\d+\.\s+/gmu, '')
    .replace(/^>\s?/gmu, '')
    .replace(/```[\s\S]*?```/g, match => match.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
}

function normalizePlainText(content: string): string {
  return content
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
