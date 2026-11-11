/**
 * Creates the Mesh server's NEAR operator key and stores it in .env.
 *
 *   node scripts/near-operator-key.mjs
 *
 * The private key is written to .env (gitignored) and never printed. Only the public key is printed,
 * so you can add it to the contract account as a function-call key limited to release_milestone and
 * freeze. A function-call key cannot attach deposits or call other methods, so it cannot fund, refund,
 * unfreeze, or change the mandate.
 */
import { generateKeyPairSync } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const ENV = ".env"
const NAME = "MESH_NEAR_OPERATOR_PRIVATE_KEY"
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

function base58(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`)
  let out = ""
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out
    value /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    out = `1${out}`
  }
  return out
}

const env = existsSync(ENV) ? readFileSync(ENV, "utf8") : ""
if (new RegExp(`^${NAME}=.+`, "m").test(env)) {
  console.error(`${NAME} already exists in ${ENV}. Remove it first if you really want a new key.`)
  process.exit(1)
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const seed = Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url")
const pub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url")

// NEAR's ed25519 secret key format is base58(seed || public key).
writeFileSync(ENV, `${env.replace(/\n*$/, "\n")}${NAME}=ed25519:${base58(Buffer.concat([seed, pub]))}\n`)
console.log(`Saved ${NAME} to ${ENV}.`)
console.log(`Public key: ed25519:${base58(pub)}`)
