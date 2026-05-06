import type { Settings, SoulProfile } from '~/types'

/**
 * Projects a Soul profile into a structured prompt fragment.
 *
 * Before:
 * - `{ identity: "工程师", style: "", preferences: "先给结论", avoidances: "", terms: "", notes: "" }`
 *
 * After:
 * - `[Role Context]\n工程师\n\n[Writing Preferences]\n- 先给结论`
 */
export function buildSoulContext(soul: Settings['soul']): string {
  if (!soul.enabled) {
    return ''
  }

  const sections = buildSoulBlocks(soul.profile)
  return sections.length > 0 ? sections.join('\n\n') : ''
}

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

function buildSoulBlocks(profile: SoulProfile): string[] {
  const blocks: string[] = []
  const writingPreferences = compactLines([
    profile.style,
    profile.preferences,
  ])

  pushSoulTextBlock(blocks, 'Role Context', profile.identity)
  pushSoulListBlock(blocks, 'Writing Preferences', writingPreferences)
  pushSoulListBlock(blocks, 'Hard Constraints', compactLines([profile.avoidances]))
  pushSoulListBlock(blocks, 'Preferred Terms', compactLines([profile.terms]))
  pushSoulTextBlock(blocks, 'Additional Notes', profile.notes)

  if (blocks.length === 0) {
    return []
  }

  blocks.push(buildApplicationRulesBlock())
  return blocks
}

function pushSoulTextBlock(target: string[], label: string, value: string) {
  const content = value.trim()
  if (!content) {
    return
  }

  target.push(`[${label}]\n${content}`)
}

function pushSoulListBlock(target: string[], label: string, values: string[]) {
  if (values.length === 0) {
    return
  }

  target.push(`[${label}]\n${values.map(value => `- ${value}`).join('\n')}`)
}

function compactLines(values: string[]): string[] {
  return values
    .flatMap(value => value.split(/\r?\n/))
    .map(value => value.trim())
    .filter(Boolean)
}

function buildApplicationRulesBlock(): string {
  return [
    '[Application Rules]',
    '- Apply these Soul cues only when they are naturally relevant to the current prefix.',
    '- Prefer influencing wording, structure, and terminology choices instead of restating these cues.',
    '- If Soul conflicts with the current user intent, follow the current user intent.',
  ].join('\n')
}
