import { describe, expect, it } from 'vitest'
import { parseModelListResponse } from '~/utils/openai-compatible'

describe('parseModelListResponse', () => {
  it('extracts model ids from a standard models response', () => {
    expect(
      parseModelListResponse({
        data: [
          { id: 'chat-model', owned_by: 'host' },
          { id: 'chat-mini', owned_by: 'host' },
        ],
      }),
    ).toEqual([
      { id: 'chat-model', ownedBy: 'host' },
      { id: 'chat-mini', ownedBy: 'host' },
    ])
  })

  it('ignores invalid items safely', () => {
    expect(
      parseModelListResponse({ data: [{ id: 'chat-model' }, null, {}, { id: 123 }] }),
    ).toEqual([
      { id: 'chat-model', ownedBy: undefined },
    ])
  })
})
