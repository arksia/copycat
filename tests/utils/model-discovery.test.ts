import { describe, expect, it } from 'vitest';
import { buildModelsUrl, parseModelListResponse } from '~/utils/model-discovery';

describe('buildModelsUrl', () => {
  it('appends /models to an openai-compatible base url', () => {
    expect(buildModelsUrl('https://llm.yunhaoli.top/v1')).toBe(
      'https://llm.yunhaoli.top/v1/models',
    );
    expect(buildModelsUrl('https://llm.yunhaoli.top/v1/')).toBe(
      'https://llm.yunhaoli.top/v1/models',
    );
  });
});

describe('parseModelListResponse', () => {
  it('extracts model ids from a standard models response', () => {
    expect(
      parseModelListResponse({
        data: [
          { id: 'free', owned_by: 'host' },
          { id: 'chat-mini', owned_by: 'host' },
        ],
      }),
    ).toEqual([
      { id: 'free', ownedBy: 'host' },
      { id: 'chat-mini', ownedBy: 'host' },
    ]);
  });

  it('ignores invalid items safely', () => {
    expect(parseModelListResponse({ data: [{ id: 'free' }, null, {}, { id: 123 }] })).toEqual([
      { id: 'free', ownedBy: undefined },
    ]);
  });
});
