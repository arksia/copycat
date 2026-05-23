import type { SoulProfile } from '~/types'

export interface SoulBlock {
  label: string
  kind: 'text' | 'list'
  values: string[]
  outputOrder: number
  inclusionPriority: number
}

export function buildExplicitSoulBlocks(profile: SoulProfile): SoulBlock[] {
  const blocks: SoulBlock[] = []
  const writingPreferences = compactLines([
    profile.style,
    profile.preferences,
  ])

  pushSoulTextBlock(blocks, {
    label: 'Role Context',
    outputOrder: 0,
    inclusionPriority: 0,
    value: profile.identity,
  })
  pushSoulListBlock(blocks, {
    label: 'Writing Preferences',
    outputOrder: 1,
    inclusionPriority: 2,
    values: writingPreferences,
  })
  pushSoulListBlock(blocks, {
    label: 'Hard Constraints',
    outputOrder: 2,
    inclusionPriority: 1,
    values: compactLines([profile.avoidances]),
  })
  pushSoulListBlock(blocks, {
    label: 'Preferred Terms',
    outputOrder: 3,
    inclusionPriority: 3,
    values: compactLines([profile.terms]),
  })
  pushSoulTextBlock(blocks, {
    label: 'Additional Notes',
    outputOrder: 4,
    inclusionPriority: 4,
    value: profile.notes,
  })

  return blocks
}

function pushSoulTextBlock(target: SoulBlock[], options: {
  label: string
  outputOrder: number
  inclusionPriority: number
  value: string
}) {
  const values = compactLines([options.value])
  if (values.length === 0) {
    return
  }

  target.push({
    label: options.label,
    kind: 'text',
    values,
    outputOrder: options.outputOrder,
    inclusionPriority: options.inclusionPriority,
  })
}

function pushSoulListBlock(target: SoulBlock[], options: {
  label: string
  outputOrder: number
  inclusionPriority: number
  values: string[]
}) {
  if (options.values.length === 0) {
    return
  }

  target.push({
    label: options.label,
    kind: 'list',
    values: options.values,
    outputOrder: options.outputOrder,
    inclusionPriority: options.inclusionPriority,
  })
}

function compactLines(values: string[]): string[] {
  return values
    .flatMap(value => value.split(/\r?\n/))
    .map(value => value.trim())
    .filter(Boolean)
}
