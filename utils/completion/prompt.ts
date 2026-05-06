import type { Settings, SoulProfile } from '~/types'

/**
 * Projects a Soul profile into a structured prompt fragment.
 *
 * Before:
 * - `{ identity: "工程师", style: "", preferences: "先给结论", avoidances: "", terms: "", notes: "" }`
 *
 * After:
 * - `[Identity]\n工程师\n\n[Preferences]\n先给结论`
 */
export function buildSoulContext(soul: Settings['soul']): string {
  if (!soul.enabled) {
    return ''
  }

  const sections = buildSoulSections(soul.profile)
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

function buildSoulSections(profile: SoulProfile): string[] {
  const sections: string[] = []

  pushSoulSection(sections, 'Identity', profile.identity)
  pushSoulSection(sections, 'Style', profile.style)
  pushSoulSection(sections, 'Preferences', profile.preferences)
  pushSoulSection(sections, 'Avoid', profile.avoidances)
  pushSoulSection(sections, 'Terms', profile.terms)
  pushSoulSection(sections, 'Notes', profile.notes)

  return sections
}

function pushSoulSection(target: string[], label: string, value: string) {
  const content = value.trim()
  if (!content) {
    return
  }

  target.push(`[${label}]\n${content}`)
}
