import type { SoulBlock } from './profile'
import type {
  DistilledSoulCue,
  LearnedSoulProfile,
  SoulObservedSignal,
} from '~/types'

export function distillSoulSignals(
  signals: SoulObservedSignal[],
): {
  profile: LearnedSoulProfile
  cues: DistilledSoulCue[]
} {
  const profile: LearnedSoulProfile = {
    preferences: [],
    avoidances: [],
    terms: [],
  }
  const cues: DistilledSoulCue[] = []

  for (const signal of signals) {
    if (signal.kind === 'preference' && signal.value === 'prefer-direct-tone') {
      const value = 'Lead with the answer when it fits naturally.'
      profile.preferences.push(value)
      cues.push({
        kind: 'preference',
        value,
        sourceSignalIds: [signal.id],
        confidence: signal.confidence,
      })
      continue
    }

    if (signal.kind === 'avoidance' && signal.value === 'avoid-marketing-language') {
      const value = 'Avoid hype, promotional language, and exaggerated claims.'
      profile.avoidances.push(value)
      cues.push({
        kind: 'avoidance',
        value,
        sourceSignalIds: [signal.id],
        confidence: signal.confidence,
      })
      continue
    }

    if (signal.kind === 'term' && signal.value.startsWith('term:')) {
      const term = signal.value.slice('term:'.length).trim()
      if (term.length === 0) {
        continue
      }
      profile.terms.push(term)
      cues.push({
        kind: 'term',
        value: term,
        sourceSignalIds: [signal.id],
        confidence: signal.confidence,
      })
      continue
    }

    if (signal.kind === 'structure') {
      const value = resolveStructureCue(signal.value)
      if (value === null) {
        continue
      }
      profile.preferences.push(value)
      cues.push({
        kind: 'preference',
        value,
        sourceSignalIds: [signal.id],
        confidence: signal.confidence,
      })
    }
  }

  return {
    profile: {
      preferences: uniqueStrings(profile.preferences),
      avoidances: uniqueStrings(profile.avoidances),
      terms: uniqueStrings(profile.terms),
    },
    cues,
  }
}

export function buildLearnedSoulBlocks(profile: LearnedSoulProfile): SoulBlock[] {
  const blocks: SoulBlock[] = []

  if (profile.preferences.length > 0) {
    blocks.push({
      label: 'Observed Preferences',
      kind: 'list',
      values: profile.preferences,
      outputOrder: 1,
      inclusionPriority: 2,
    })
  }

  if (profile.avoidances.length > 0) {
    blocks.push({
      label: 'Observed Avoidances',
      kind: 'list',
      values: profile.avoidances,
      outputOrder: 2,
      inclusionPriority: 1,
    })
  }

  if (profile.terms.length > 0) {
    blocks.push({
      label: 'Observed Terms',
      kind: 'list',
      values: profile.terms,
      outputOrder: 3,
      inclusionPriority: 3,
    })
  }

  return blocks
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function resolveStructureCue(value: string): string | null {
  if (value === 'answer-first') {
    return 'Lead with the answer before adding context.'
  }

  if (value === 'list-first') {
    return 'Use a list-first structure when the prefix asks for multiple items.'
  }

  if (value === 'context-first') {
    return 'Add brief context before the answer when setup matters.'
  }

  return null
}
