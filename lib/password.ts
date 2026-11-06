import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"

const N = 2 ** 15
const R = 8
const P = 1
const KEY_LENGTH = 64
// scrypt needs 128 * N * r bytes; Node's default cap is exactly too low for these parameters.
const MAX_MEMORY = 128 * N * R * 2

function derive(password: string, salt: Buffer, n: number, r: number, p: number, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { N: n, r, p, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

/** Format: scrypt$N$r$p$saltB64$keyB64, so parameters can be raised later. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P, KEY_LENGTH)
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, key] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !key) return false
  const expected = Buffer.from(key, "base64")
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), expected.length)
  return timingSafeEqual(actual, expected)
}

/** Burns the same work as a real check so unknown emails are not distinguishable by timing. */
const decoy = hashPassword(randomBytes(16).toString("hex"))
export async function verifyDecoy(password: string) {
  await verifyPassword(password, await decoy)
  return false
}
