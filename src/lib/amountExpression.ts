type Rational = {
  numerator: bigint
  denominator: bigint
}

const maxExpressionLength = 80
const maxParenthesisDepth = 12
const numberTokenPattern = /^(?:0|[1-9]\d*)(?:\.(\d{1,6}))?/

function greatestCommonDivisor(left: bigint, right: bigint) {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new Error('Division by zero is not allowed')
  const sign = denominator < 0n ? -1n : 1n
  const normalizedNumerator = numerator * sign
  const normalizedDenominator = denominator * sign
  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator)
  return {
    numerator: normalizedNumerator / divisor,
    denominator: normalizedDenominator / divisor,
  }
}

function add(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  )
}

function subtract(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  )
}

function multiply(left: Rational, right: Rational) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator)
}

function divide(left: Rational, right: Rational) {
  return rational(left.numerator * right.denominator, left.denominator * right.numerator)
}

function decimalTokenToRational(token: string): Rational {
  const [major, fraction = ''] = token.split('.')
  const denominator = 10n ** BigInt(fraction.length)
  return rational(BigInt(`${major}${fraction}`), denominator)
}

export function evaluateAmountExpression(expression: string, allowSignedResult = false) {
  if (expression.length === 0 || expression.length > maxExpressionLength) {
    throw new Error('Amount calculation is outside the supported length')
  }

  let index = 0
  let parenthesisDepth = 0

  const skipSpaces = () => {
    while (expression[index] === ' ') index += 1
  }

  const parsePrimary = (): Rational => {
    skipSpaces()
    if (expression[index] === '(') {
      parenthesisDepth += 1
      if (parenthesisDepth > maxParenthesisDepth) {
        throw new Error('Amount calculation is nested too deeply')
      }
      index += 1
      const value = parseExpression()
      skipSpaces()
      if (expression[index] !== ')') throw new Error('Amount calculation has unmatched parentheses')
      index += 1
      parenthesisDepth -= 1
      return value
    }

    const match = numberTokenPattern.exec(expression.slice(index))
    if (!match) throw new Error('Amount calculation contains an invalid number')
    index += match[0].length
    return decimalTokenToRational(match[0])
  }

  const parseTerm = (): Rational => {
    let value = parsePrimary()
    while (true) {
      skipSpaces()
      const operator = expression[index]
      if (operator !== '*' && operator !== '/') return value
      index += 1
      const right = parsePrimary()
      value = operator === '*' ? multiply(value, right) : divide(value, right)
    }
  }

  const parseExpression = (): Rational => {
    let value = parseTerm()
    while (true) {
      skipSpaces()
      const operator = expression[index]
      if (operator !== '+' && operator !== '-') return value
      index += 1
      const right = parseTerm()
      value = operator === '+' ? add(value, right) : subtract(value, right)
    }
  }

  const result = parseExpression()
  skipSpaces()
  if (index !== expression.length) throw new Error('Amount calculation contains unsupported text')
  if (!allowSignedResult && result.numerator <= 0n) {
    throw new Error('Amount must be greater than zero')
  }

  const sign = result.numerator < 0n ? -1n : 1n
  const scaledNumerator = (result.numerator < 0n ? -result.numerator : result.numerator) * 100n
  const quotient = scaledNumerator / result.denominator
  const remainder = scaledNumerator % result.denominator
  const magnitude = remainder * 2n >= result.denominator ? quotient + 1n : quotient
  const roundedMinor = magnitude * sign
  if (
    (!allowSignedResult && roundedMinor <= 0n)
    || magnitude > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error('Amount exceeds the safe integer range')
  }
  return Number(roundedMinor)
}
