/** NEAR amounts, account IDs and transaction hashes. Safe to import in browser and server code. */

export const YOCTO_DECIMALS = 24
const YOCTO_PER_NEAR = BigInt("1000000000000000000000000")

/** "1.5" NEAR -> "1500000000000000000000000" yoctoNEAR, or null if the text is not a positive amount. */
export function nearToYocto(text: string): string | null {
  const match = /^(\d{1,9})(?:\.(\d{1,24}))?$/.exec(text.trim())
  if (!match) return null
  const yocto = BigInt(match[1]) * YOCTO_PER_NEAR + BigInt((match[2] ?? "").padEnd(YOCTO_DECIMALS, "0"))
  return yocto > BigInt(0) ? yocto.toString() : null
}

/** yoctoNEAR -> "1.5 NEAR", trimmed to at most `digits` decimals (rounded down). */
export function formatYocto(yocto: string | bigint, digits = 4) {
  const value = BigInt(yocto)
  const whole = value / YOCTO_PER_NEAR
  const fraction = (value % YOCTO_PER_NEAR).toString().padStart(YOCTO_DECIMALS, "0").slice(0, digits).replace(/0+$/, "")
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} NEAR`
}

/** Splits a total into `count` parts; the last part takes the remainder, so the parts sum exactly. */
export function splitYocto(total: string, count: number): string[] {
  const value = BigInt(total)
  const share = value / BigInt(count)
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? value - share * BigInt(count - 1) : share).toString())
}

/** NEAR account ID rules: 2-64 chars, lowercase alphanumerics separated by single - _ or . */
export function isNearAccountId(value: string) {
  return value.length >= 2 && value.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
}

export const isValidAccountId = isNearAccountId
export const toYocto = nearToYocto

/** A NEAR transaction hash is 32 bytes, base58-encoded. */
export function isTxHash(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(value)
}
