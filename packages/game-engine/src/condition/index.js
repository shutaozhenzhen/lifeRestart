export function check(condition, properties) {
  try {
    const fn = new Function('params', `"use strict"; return (${condition})`)
    return Boolean(fn(properties))
  } catch (e) {
    throw new Error(`Condition evaluation failed: ${e.message}\n  Condition: ${condition}`)
  }
}
