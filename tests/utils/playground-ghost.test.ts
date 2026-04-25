import { afterEach, describe, expect, it } from 'vitest';
import { GhostTextOverlay } from '~/utils/ghost-text';
import { syncPlaygroundGhostText } from '~/utils/playground-ghost';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement
    .querySelectorAll('[data-copycat-ghost]')
    .forEach((node) => node.remove());
});

describe('syncPlaygroundGhostText', () => {
  it('shows ghost text for a focused textarea suggestion', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(5, 5);
    Object.defineProperty(textarea, 'clientWidth', { configurable: true, value: 198 });
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 78 });
    textarea.getBoundingClientRect = () => new DOMRect(20, 100, 200, 80);

    const overlay = new GhostTextOverlay();
    const shown = syncPlaygroundGhostText(overlay, textarea, ' world');

    const ghost = document.documentElement.querySelector(
      '[data-copycat-ghost]',
    ) as HTMLElement | null;

    expect(shown).toBe(true);
    expect(ghost?.style.display).toBe('block');
    expect(ghost?.textContent).toContain(' world');
  });

  it('hides ghost text when the suggestion is cleared', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'hello';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(5, 5);
    Object.defineProperty(textarea, 'clientWidth', { configurable: true, value: 198 });
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 78 });
    textarea.getBoundingClientRect = () => new DOMRect(20, 100, 200, 80);

    const overlay = new GhostTextOverlay();
    syncPlaygroundGhostText(overlay, textarea, ' world');
    const shown = syncPlaygroundGhostText(overlay, textarea, '');

    const ghost = document.documentElement.querySelector(
      '[data-copycat-ghost]',
    ) as HTMLElement | null;

    expect(shown).toBe(false);
    expect(ghost?.style.display).toBe('none');
  });
});
