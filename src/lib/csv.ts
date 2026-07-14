const spreadsheetFormulaPrefix = /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@\uFF0B\uFF0D\uFF1D\uFF20])/
const leadingApostrophes = /^'+/

export function isSpreadsheetFormulaText(value: string) {
  return spreadsheetFormulaPrefix.test(value)
}

function needsSpreadsheetFormulaEscape(value: string) {
  return isSpreadsheetFormulaText(value.replace(leadingApostrophes, ''))
}

export function csvText(value: string) {
  const spreadsheetSafe = needsSpreadsheetFormulaEscape(value) ? `'${value}` : value
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`
}

export function restoreSpreadsheetText(value: string) {
  if (!value.startsWith("'")) return value
  const restored = value.slice(1)
  return needsSpreadsheetFormulaEscape(restored) ? restored : value
}
