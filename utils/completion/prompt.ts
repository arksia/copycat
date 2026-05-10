/**
 * Re-exported Soul prompt helpers.
 *
 * Use when:
 * - existing completion-facing imports still resolve through the old path during migration
 *
 * Returns:
 * - the Soul domain prompt helpers without changing behavior
 */
export { buildSoulContext, buildSoulProjection } from '~/soul/prompt'

/**
 * Builds the full user prompt for one completion request.
 *
 * Use when:
 * - a completion request needs Soul, knowledge, and cursor context assembled consistently
 * - settings and debug surfaces must share the same projection rules
 *
 * Expects:
 * - `prefix` to contain the current text before the cursor
 * - optional Soul and knowledge context to already be plain strings
 *
 * Returns:
 * - a stable prompt body for the OpenAI-compatible chat request
 */
export function buildCompletionUserPrompt(args: {
  prefix: string
  suffix?: string
  context?: string
  soulContext?: string
}): string {
  const userParts: string[] = []

  if (args.soulContext !== undefined && args.soulContext.trim().length > 0) {
    userParts.push(`[Soul]\n${args.soulContext.trim()}`)
  }

  if (args.context !== undefined && args.context.trim().length > 0) {
    userParts.push(`[Knowledge]\n${args.context.trim()}`)
  }

  userParts.push(
    `[Prefix]\n${args.prefix}\n\n[Task]\nContinue the prefix with a short, natural continuation. `
    + `Output ONLY the continuation text, without repeating the prefix.`,
  )

  if (args.suffix !== undefined && args.suffix.trim().length > 0) {
    userParts.push(`[Suffix after cursor]\n${args.suffix}`)
  }

  return userParts.join('\n\n')
}
