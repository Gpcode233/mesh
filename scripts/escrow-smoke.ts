/**
 * Real NEAR testnet smoke test of the escrow flow, against a throwaway database.
 *
 *   DATABASE_URL=file:./data/escrow-smoke.db bun scripts/escrow-smoke.ts plan <supplier.testnet>
 *     -> creates an RFQ, bids and an order, sets the supplier account, prints the fund_order call
 *   (the owner signs fund_order with the CLI)
 *   DATABASE_URL=file:./data/escrow-smoke.db bun scripts/escrow-smoke.ts confirm <rfqId> <txHash>
 *   DATABASE_URL=file:./data/escrow-smoke.db bun scripts/escrow-smoke.ts release <rfqId> <position> <evidenceUrl>
 *
 * Needs MESH_ESCROW_CONTRACT_ID and MESH_NEAR_OPERATOR_PRIVATE_KEY. Moves real testnet NEAR.
 */
import { eq } from "drizzle-orm"
import type { Session } from "../lib/auth"
import { getDb } from "../lib/db"
import { memberships, organizations, users } from "../lib/db/schema"
import { createRfq, recordBid, selectBid, updatePolicy } from "../lib/procurement"
import { confirmFunding, freezeEscrowOnChain, getEscrowViewForOrder, getFundingPlan, releaseOrderMilestone, setSupplierNearAccount } from "../lib/settlement"

if (!process.env.DATABASE_URL?.includes("escrow-smoke")) {
  console.error("Refusing to run against a real database. Set DATABASE_URL=file:./data/escrow-smoke.db.")
  process.exit(1)
}

async function ownerSession(): Promise<Session> {
  const db = getDb()
  const [org] = await db.select().from(organizations).limit(1)
  const [member] = await db.select().from(memberships).where(eq(memberships.orgId, org.id)).limit(1)
  const [user] = await db.select().from(users).where(eq(users.id, member.userId))
  return { sessionId: "smoke", userId: user.id, email: user.email, name: user.name, orgId: org.id, orgName: org.name, role: "owner" }
}

const [command, ...args] = process.argv.slice(2)
const session = await ownerSession()

if (command === "plan") {
  await updatePolicy(session, {
    dailySpendLimit: 1_000_000, perOrderLimit: 1_000_000, approvalThreshold: 1_000_000, requiredBidCount: 1,
    approvedRegions: [], requiredDocuments: [], approvedAssets: ["NEAR"], approvedChains: ["NEAR"],
    agentKeyExpiryHours: 720, freezeBehavior: "Stop all payouts.",
  })
  const rfq = await createRfq(session, { resource: "Steel bolts M12", quantity: 1000, unit: "pcs", maxBudget: 5000, deadline: "2026-12-31", destination: "Rotterdam" })
  const rfqId = rfq
  const bid = await recordBid(session, rfqId, { supplier: `Smoke Supplier ${Date.now()}`, amount: 4200, region: "EU", documents: [] })
  await selectBid(session, rfqId, bid)
  const view = await getEscrowViewForOrder(session.orgId, rfqId)
  await setSupplierNearAccount(session, view!.supplierId, args[0])
  const plan = await getFundingPlan(session, rfqId)
  console.log(JSON.stringify({ rfqId, plan }, null, 2))
} else if (command === "confirm") {
  console.log(await confirmFunding(session, args[0], args[1]))
  console.log(JSON.stringify(await getEscrowViewForOrder(session.orgId, args[0]), null, 2))
} else if (command === "release") {
  console.log(await releaseOrderMilestone(session, args[0], Number(args[1]), args[2]))
  console.log(JSON.stringify(await getEscrowViewForOrder(session.orgId, args[0]), null, 2))
} else if (command === "freeze") {
  console.log(await freezeEscrowOnChain(session))
} else {
  console.error("Usage: plan <supplier> | confirm <rfqId> <txHash> | release <rfqId> <position> <evidenceUrl>")
  process.exit(1)
}
