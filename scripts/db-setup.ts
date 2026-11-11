/**
 * Applies migrations and seeds one organization, one operator, the six agents and a default policy.
 * Idempotent: an existing operator keeps their password.
 *
 *   bun scripts/db-setup.ts           Requires MESH_OPERATOR_EMAIL and MESH_OPERATOR_PASSWORD.
 *   bun scripts/db-setup.ts --reset   Also deletes a local database first (tests only).
 */
import { mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { createClient } from "@libsql/client"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import { AGENT_LIST } from "../lib/agents"
import { agents, memberships, organizations, policies, users } from "../lib/db/schema"
import { hashPassword } from "../lib/password"

const url = process.env.DATABASE_URL || "file:./data/mesh.db"
const email = process.env.MESH_OPERATOR_EMAIL?.trim().toLowerCase()
const password = process.env.MESH_OPERATOR_PASSWORD

if (!email || !password || password.length < 12) {
  console.error("Set MESH_OPERATOR_EMAIL and MESH_OPERATOR_PASSWORD (at least 12 characters).")
  process.exit(1)
}

if (url.startsWith("file:")) {
  const path = url.slice("file:".length)
  if (process.argv.includes("--reset")) for (const suffix of ["", "-shm", "-wal"]) rmSync(path + suffix, { force: true })
  mkdirSync(dirname(path), { recursive: true })
}

const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined })
const db = drizzle(client)
await migrate(db, { migrationsFolder: "./drizzle" })

let [org] = await db.select().from(organizations).limit(1)
if (!org) [org] = await db.insert(organizations).values({ name: process.env.MESH_ORG_NAME || "Mesh" }).returning()

let [user] = await db.select().from(users).where(eq(users.email, email))
if (!user) {
  ;[user] = await db.insert(users).values({ email, name: process.env.MESH_OPERATOR_NAME || "Operator", passwordHash: await hashPassword(password) }).returning()
  console.log(`Created operator ${email}`)
} else {
  console.log(`Operator ${email} already exists; password unchanged`)
}

await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: "owner" }).onConflictDoNothing()
for (const agent of AGENT_LIST) {
  await db.insert(agents).values({ orgId: org.id, role: agent.id, name: agent.label }).onConflictDoNothing()
}
await db.insert(policies).values({
  orgId: org.id,
  dailySpendLimitCents: 5_000_000,
  perOrderLimitCents: 2_000_000,
  approvalThresholdCents: 1_000_000,
  requiredBidCount: 3,
  approvedRegions: ["EU", "US", "JP"],
  requiredDocuments: ["ISO 9001", "Sanctions screening"],
  approvedAssets: ["NEAR", "USDC", "USDT"],
  approvedChains: ["NEAR", "Ethereum"],
  agentKeyExpiryHours: 24,
  freezeBehavior: "Revoke all keys",
}).onConflictDoNothing()

client.close()
console.log(`Database ready at ${url}`)
