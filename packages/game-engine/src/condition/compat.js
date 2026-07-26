const BUILTINS = new Set([
  'Math', 'true', 'false', 'null', 'undefined',
  'NaN', 'Infinity', 'Date', 'JSON', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'RegExp', 'Map', 'Set',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
])

function quoteIfNeeded(val) {
  const trimmed = val.trim()
  if (!trimmed) return ''
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  return `"${trimmed}"`
}

function parseValues(values) {
  return values.split(',').filter(Boolean).map(quoteIfNeeded).join(',')
}

export function convertLegacy(condition, propTypes = {}) {
  let result = condition

  // 1. ?[values] → .some() or .includes()
  result = result.replace(/(\w+)\?\[([^\]]*)\]/g, (_m, prop, values) => {
    const parsed = parseValues(values)
    if (propTypes[prop] === 'array') {
      return `${prop}.some(id => [${parsed}].includes(id))`
    }
    return `[${parsed}].includes(${prop})`
  })

  // 2. ![values] → negated .some() or .includes()
  result = result.replace(/(\w+)\!\[([^\]]*)\]/g, (_m, prop, values) => {
    const parsed = parseValues(values)
    if (propTypes[prop] === 'array') {
      return `!${prop}.some(id => [${parsed}].includes(id))`
    }
    return `![${parsed}].includes(${prop})`
  })

  // 3. & → &&
  result = result.replace(/&/g, ' && ')

  // 4. | → ||
  result = result.replace(/\|/g, ' || ')

  // 5. != → !== (with spaces)
  result = result.replace(/([A-Z][A-Z0-9!?]*) *!= *(\d+|true|false)/g, '$1 !== $2')

  // 6. >= ≤
  result = result.replace(/([A-Z][A-Z0-9!?]*) *(>=|<=) *(\d+)/g, '$1 $2 $3')

  // 7. = → === for simple equality
  result = result.replace(/([A-Z][A-Z0-9!?]*) *= *(?=\d+)/g, '$1 === ')

  // 8. > < with spaces
  result = result.replace(/([A-Z][A-Z0-9]*) *> *(\d+)/g, '$1 > $2')
  result = result.replace(/([A-Z][A-Z0-9]*) *< *(\d+)/g, '$1 < $2')

  // 9. params. prefix (skip JS builtins and keywords)
  result = result.replace(/\b([A-Z][A-Z0-9_]*)\b/g, (match) => {
    if (BUILTINS.has(match)) return match
    if (match === 'id' || match === 'return') return match
    return `params.${match}`
  })

  result = result.replace(/  +/g, ' ').trim()

  return result
}
