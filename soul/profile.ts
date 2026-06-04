export interface SoulBlock {
  label: string
  kind: 'text' | 'list'
  values: string[]
  outputOrder: number
  inclusionPriority: number
}

export function buildPinnedSoulBlocks(text: string): SoulBlock[] {
  const blocks: SoulBlock[] = []
  pushSoulTextBlock(blocks, {
    label: 'Pinned Soul',
    outputOrder: 0,
    inclusionPriority: 0,
    value: text,
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

function compactLines(values: string[]): string[] {
  return values
    .flatMap(value => value.split(/\r?\n/))
    .map(value => value.trim())
    .filter(Boolean)
}
