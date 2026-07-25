// Shared test helpers.

/**
 * A reusable no-op. Handy for `.mockImplementation(noop)` and for stubbing
 * optional callback props in render(...) calls, avoiding a fresh empty arrow
 * function at every call site (which the lint rule flags as an empty function).
 */
export const noop = (): void => {
  // Intentionally does nothing.
};

/**
 * Asserts a value is present and returns it narrowed. Throws (failing the test
 * loudly with a clear message) when the value is null/undefined — the same
 * runtime outcome a bare non-null assertion (`x!`) would produce on a missing
 * value, but type-safe and without the forbidden `!`.
 */
export function requireDefined<T>(value: T | null | undefined, message = 'expected a value to be defined'): T {
  if (value == null) throw new Error(message);
  return value;
}
