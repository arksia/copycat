/**
 * Process-local monotonic suffix used to keep same-millisecond IDs distinct.
 */
let counter = 0

/**
 * Builds a short request or UI identifier with a caller-supplied prefix.
 *
 * Before:
 * - `prefix = "req"`
 *
 * After:
 * - `"req_lj7j0k_a"`
 */
export function nextId(prefix = 'c'): string {
  counter = (counter + 1) & 0xFFFFFF
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}
