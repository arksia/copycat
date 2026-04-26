/**
 * Opens the extension settings page in a dedicated browser tab.
 *
 * Use when:
 * - linking to settings from popup, background install flow, or playground
 * - `chrome.runtime.openOptionsPage()` is less reliable for the current surface
 *
 * Expects:
 * - the extension has an `options.html` entrypoint
 *
 * Returns:
 * - a promise that resolves after the tab creation request is handed to Chrome
 */
export async function openSettingsPage() {
  const url = chrome.runtime.getURL('options.html')
  await chrome.tabs.create({ url })
}
