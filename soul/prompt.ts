import type { SoulBlock } from './profile'
import type {
  ObservedSoulProfile,
  SoulBudgetMeta,
  SoulProjectionInput,
} from '~/types'
import { buildObservedSoulBlocks } from './distill'
import { buildPinnedSoulBlocks } from './profile'

const BLOCK_SEPARATOR = '\n\n'
const LIST_ITEM_PREFIX = '- '
const SOUL_CHAR_BUDGET = 1200
const TRUNCATION_SUFFIX = '...'

export interface SoulProjection {
  context: string
  meta: SoulBudgetMeta
}

/**
 * Projects pinned and observed Soul cues into one structured prompt fragment.
 *
 * Before:
 * - `{ text: "工程师\n先给结论" }`
 *
 * After:
 * - `[Pinned Soul]\n工程师\n先给结论`
 */
export function buildSoulContext(input: SoulProjectionInput): string {
  return buildSoulProjection(input).context
}

/**
 * Builds the full Soul prompt projection plus budget metadata.
 *
 * Use when:
 * - completion requests need the current Soul fragment
 * - debug or settings surfaces need the exact projected output and packing metadata
 *
 * Returns:
 * - the rendered Soul context plus packing metadata
 */
export function buildSoulProjection(input: SoulProjectionInput): SoulProjection {
  if (!input.enabled) {
    return buildEmptySoulProjection()
  }

  const blocks = mergeSoulBlocks(
    buildPinnedSoulBlocks(input.text),
    buildObservedSoulBlocks(input.observed ?? buildEmptyObservedSoulProfile()),
  )
  if (blocks.length === 0) {
    return buildEmptySoulProjection()
  }

  const applicationRulesBlock = buildApplicationRulesBlock()
  const applicationRulesText = renderSoulBlock(applicationRulesBlock)
  if (applicationRulesText.length >= SOUL_CHAR_BUDGET) {
    return {
      context: applicationRulesText,
      meta: {
        totalChars: SOUL_CHAR_BUDGET,
        reservedChars: applicationRulesText.length,
        usedChars: applicationRulesText.length,
        truncated: true,
        includedBlocks: [applicationRulesBlock.label],
        droppedBlocks: blocks.map(block => block.label),
        trimmedBlocks: [],
      },
    }
  }

  const reservedChars = applicationRulesText.length + BLOCK_SEPARATOR.length
  const availableChars = SOUL_CHAR_BUDGET - reservedChars
  const budgetResult = fitSoulBlocksWithinBudget(blocks, Math.max(0, availableChars))
  const includedBlocks = budgetResult.blocks
  const orderedBlocks = includedBlocks
    .sort((left, right) => left.outputOrder - right.outputOrder)
    .map(renderSoulBlock)
  const context = orderedBlocks.length > 0
    ? [...orderedBlocks, applicationRulesText].join(BLOCK_SEPARATOR)
    : applicationRulesText

  return {
    context,
    meta: {
      totalChars: SOUL_CHAR_BUDGET,
      reservedChars,
      usedChars: context.length,
      truncated: budgetResult.truncated,
      includedBlocks: [
        ...includedBlocks
          .sort((left, right) => left.outputOrder - right.outputOrder)
          .map(block => block.label),
        applicationRulesBlock.label,
      ],
      droppedBlocks: blocks
        .filter(block => !includedBlocks.some(included => included.label === block.label))
        .map(block => block.label),
      trimmedBlocks: budgetResult.trimmedBlocks,
    },
  }
}

function buildApplicationRulesBlock(): SoulBlock {
  return {
    label: 'Application Rules',
    kind: 'list',
    values: [
      'Apply these Soul cues only when they are naturally relevant to the current prefix.',
      'Prefer influencing wording, structure, and terminology choices instead of restating these cues.',
      'If Soul conflicts with the current user intent, follow the current user intent.',
    ],
    outputOrder: 5,
    inclusionPriority: 5,
  }
}

function mergeSoulBlocks(explicitBlocks: SoulBlock[], observedBlocks: SoulBlock[]): SoulBlock[] {
  return [...explicitBlocks, ...observedBlocks]
}

function fitSoulBlocksWithinBudget(blocks: SoulBlock[], budget: number): {
  blocks: SoulBlock[]
  truncated: boolean
  trimmedBlocks: SoulBudgetMeta['trimmedBlocks']
} {
  const selectedBlocks: SoulBlock[] = []
  const blocksByPriority = [...blocks].sort((left, right) => left.inclusionPriority - right.inclusionPriority)
  const trimmedBlocks: SoulBudgetMeta['trimmedBlocks'] = []
  let usedChars = 0
  let truncated = false

  for (const block of blocksByPriority) {
    const remainingChars = budget - usedChars - (selectedBlocks.length > 0 ? BLOCK_SEPARATOR.length : 0)
    if (remainingChars <= 0) {
      truncated = true
      continue
    }

    const fittedBlock = fitSoulBlock(block, remainingChars)
    if (!fittedBlock) {
      truncated = true
      trimmedBlocks.push({
        label: block.label,
        wasDropped: true,
      })
      continue
    }

    if (!isSoulBlockEqual(block, fittedBlock)) {
      truncated = true
      trimmedBlocks.push({
        label: block.label,
        wasDropped: false,
      })
    }

    selectedBlocks.push(fittedBlock)
    usedChars += renderSoulBlock(fittedBlock).length
    if (selectedBlocks.length > 1) {
      usedChars += BLOCK_SEPARATOR.length
    }
  }

  return {
    blocks: selectedBlocks,
    truncated,
    trimmedBlocks,
  }
}

function fitSoulBlock(block: SoulBlock, budget: number): SoulBlock | null {
  if (renderSoulBlock(block).length <= budget) {
    return block
  }

  if (block.kind === 'text') {
    return fitTextSoulBlock(block, budget)
  }

  return fitListSoulBlock(block, budget)
}

function fitTextSoulBlock(block: SoulBlock, budget: number): SoulBlock | null {
  const values: string[] = []

  for (const value of block.values) {
    const nextValues = [...values, value]
    if (renderSoulBlock({ ...block, values: nextValues }).length <= budget) {
      values.push(value)
      continue
    }

    const truncatedValue = truncateToFit({
      availableChars: remainingValueChars(block, values, budget),
      prefix: values.length > 0 ? '\n' : '',
      value,
    })

    if (truncatedValue !== null) {
      values.push(truncatedValue)
    }

    break
  }

  return values.length > 0 ? { ...block, values } : null
}

function fitListSoulBlock(block: SoulBlock, budget: number): SoulBlock | null {
  const values: string[] = []

  for (const value of block.values) {
    const nextValues = [...values, value]
    if (renderSoulBlock({ ...block, values: nextValues }).length <= budget) {
      values.push(value)
      continue
    }

    if (values.length > 0) {
      break
    }

    const truncatedValue = truncateToFit({
      availableChars: remainingValueChars(block, values, budget),
      prefix: LIST_ITEM_PREFIX,
      value,
    })

    if (truncatedValue !== null) {
      values.push(truncatedValue)
    }

    break
  }

  return values.length > 0 ? { ...block, values } : null
}

function remainingValueChars(block: SoulBlock, values: string[], budget: number): number {
  const renderedPrefix = renderBlockHeader(block.label)
  const renderedValues = renderSoulBlockValues(block.kind, values)
  const separator = values.length > 0 ? '\n' : ''
  return budget - renderedPrefix.length - renderedValues.length - separator.length
}

function truncateToFit(options: {
  availableChars: number
  prefix: string
  value: string
}): string | null {
  const availableChars = options.availableChars - options.prefix.length
  if (availableChars <= 0) {
    return null
  }

  if (options.value.length <= availableChars) {
    return options.value
  }

  if (availableChars <= TRUNCATION_SUFFIX.length) {
    return null
  }

  return `${options.value.slice(0, availableChars - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
}

function renderSoulBlock(block: SoulBlock): string {
  return `${renderBlockHeader(block.label)}\n${renderSoulBlockValues(block.kind, block.values)}`
}

function renderBlockHeader(label: string): string {
  return `[${label}]`
}

function renderSoulBlockValues(kind: SoulBlock['kind'], values: string[]): string {
  if (kind === 'list') {
    return values.map(value => `${LIST_ITEM_PREFIX}${value}`).join('\n')
  }

  return values.join('\n')
}

function buildEmptySoulProjection(): SoulProjection {
  return {
    context: '',
    meta: {
      totalChars: SOUL_CHAR_BUDGET,
      reservedChars: 0,
      usedChars: 0,
      truncated: false,
      includedBlocks: [],
      droppedBlocks: [],
      trimmedBlocks: [],
    },
  }
}

function buildEmptyObservedSoulProfile(): ObservedSoulProfile {
  return {
    preferences: [],
    avoidances: [],
    terms: [],
  }
}

function isSoulBlockEqual(left: SoulBlock, right: SoulBlock): boolean {
  return left.label === right.label
    && left.kind === right.kind
    && left.outputOrder === right.outputOrder
    && left.inclusionPriority === right.inclusionPriority
    && left.values.length === right.values.length
    && left.values.every((value, index) => value === right.values[index])
}
