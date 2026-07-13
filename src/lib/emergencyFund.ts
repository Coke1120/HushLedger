export type EmergencyFundProgress = {
  savedMinor: number | null
  remainingMinor: number | null
  basisPoints: number | null
  complete: boolean
}

export function calculateEmergencyFundProgress(
  recordedBalance: number | null,
  targetMinor: number,
): EmergencyFundProgress {
  if (!Number.isSafeInteger(targetMinor) || targetMinor <= 0) {
    throw new Error('Emergency fund target must be a positive safe integer')
  }
  if (recordedBalance === null) {
    return { savedMinor: null, remainingMinor: null, basisPoints: null, complete: false }
  }
  if (!Number.isSafeInteger(recordedBalance)) {
    throw new Error('Recorded balance must be a safe integer or null')
  }

  const savedMinor = Math.min(Math.max(recordedBalance, 0), targetMinor)
  const basisPoints = Number((BigInt(savedMinor) * 10_000n) / BigInt(targetMinor))
  return {
    savedMinor,
    remainingMinor: targetMinor - savedMinor,
    basisPoints,
    complete: savedMinor === targetMinor,
  }
}
