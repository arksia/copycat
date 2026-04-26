/**
 * A debounced function with explicit cancellation and immediate flush controls.
 *
 * Use when:
 * - repeated UI events should collapse into one action
 * - callers need to cancel pending work during teardown
 *
 * Expects:
 * - `F` to be a side-effecting function triggered by repeated events
 *
 * Returns:
 * - the original callable shape plus `cancel` and `flush` helpers
 */
export type Debounced<F extends (...args: unknown[]) => void> = F & {
  cancel: () => void
  flush: () => void
}

/**
 * Wraps a function so repeated calls collapse into one delayed invocation.
 *
 * Use when:
 * - input, scroll, resize, or selection changes should not trigger immediate repeated work
 * - teardown code needs to cancel pending work explicitly
 *
 * Expects:
 * - `fn` to be safe to invoke with the latest arguments only
 * - `waitMs` to be a non-negative debounce delay
 *
 * Returns:
 * - a debounced callable with `cancel()` and `flush()` controls
 */
export function debounce<F extends (...args: unknown[]) => void>(
  fn: F,
  waitMs: number,
): Debounced<F> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<F> | null = null

  const invoke = () => {
    if (!lastArgs)
      return
    const args = lastArgs
    lastArgs = null
    fn(...args)
  }

  const debounced = ((...args: Parameters<F>) => {
    lastArgs = args
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      invoke()
    }, waitMs)
  }) as Debounced<F>

  debounced.cancel = () => {
    if (timer)
      clearTimeout(timer)
    timer = null
    lastArgs = null
  }

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    invoke()
  }

  return debounced
}
