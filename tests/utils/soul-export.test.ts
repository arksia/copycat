import type { SoulLearningLogEntry } from '~/types'
import { describe, expect, it } from 'vitest'
import { formatSoulLogLine, formatSoulMarkdown } from '~/soul'

describe('formatSoulMarkdown', () => {
  it('writes trimmed Soul text with one trailing newline', () => {
    expect(formatSoulMarkdown('  先给结论\n再列步骤  ')).toBe('先给结论\n再列步骤\n')
  })

  it('returns an empty string for empty Soul text', () => {
    expect(formatSoulMarkdown('   ')).toBe('')
  })
})

describe('formatSoulLogLine', () => {
  it('serializes one log entry per line', () => {
    const entry: SoulLearningLogEntry = {
      acceptedCount: 5,
      droppedCounts: {
        actionBucketFull: 1,
        duplicate: 2,
        windowLimit: 0,
      },
      freshEventCount: 12,
      reason: 'repeated preference for direct openings',
      rejectedCount: 4,
      selectedEventCount: 9,
      timestamp: '2026-06-07T16:40:12.000Z',
      trigger: 'accepted_rejected_threshold',
      updated: true,
    }

    expect(formatSoulLogLine(entry)).toBe(`${JSON.stringify(entry)}\n`)
  })
})
