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
    `[Prefix]\n${args.prefix}\n\n[Task]\nDecide whether the prefix still needs continuation. `
    + `If it is already complete, output EXACTLY __COPYCAT_SKIP__. `
    + `If it is unfinished, continue it with ONE short, natural continuation in the SAME language as the prefix. `
    + `If the natural next character is punctuation, start with that punctuation instead of skipping it. `
    + `Output ONLY __COPYCAT_SKIP__ or the continuation text, without repeating the prefix. `
    + `Keep it short: a few words up to one sentence.`,
  )

  if (args.suffix !== undefined && args.suffix.trim().length > 0) {
    userParts.push(`[Suffix after cursor]\n${args.suffix}`)
  }

  return userParts.join('\n\n')
}
