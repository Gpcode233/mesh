/**
 * Order escrow on NEAR: the supplier's account, funding (signed by the owner in their wallet, verified
 * here), milestone payouts (signed by the server's restricted operator key) and the on-chain freeze.
 *
 * Nothing is marked funded or paid until the chain shows it at FINAL finality.
 */
import { and, asc, eq, inArray } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import type { Session } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { bids, evidence, milestones, orders, policies, rfqs, settlements, suppliers } from "@/lib/db/schema"
import {
  EscrowError,
  evidenceHash,
  freezeOnChain,
  getEscrowConfig,
  operatorTxSucceeded,
  releaseMilestoneOnChain,
  verifyFundingTx,
  viewEscrowConfig,
  viewEscrowOrder,
  type ChainOrder,
} from "@/lib/escrow"
import { isNearAccountId, isTxHash, nearToYocto } from "@/lib/near-amount"
import { DomainError } from "@/lib/procurement"
import { isWebUrl, SETTLEMENT_ROUTE, type ChainTxView, type EscrowMilestoneView, type EscrowView } from "@/lib/rfq"

const auditFor = (session: Session) => ({ orgId: session.orgId, actorUserId: session.userId })

// Testnet escrow: two milestones of 0.05 NEAR each. These are NEAR amounts chosen for the testnet demo;
// they are not converted from the USD bid.
const DEFAULT_MILESTONES = [
  { position: 0, title: "Milestone 1", near: "0.05" },
  { position: 1, title: "Milestone 2", near: "0.05" },
] as const
const FUND_GAS = "30000000000000"

const fundKey = (rfqId: string) => `fund:${rfqId}`
const payoutKey = (rfqId: string, position: number) => `release:${rfqId}:${position}`

function requireEscrow() {
  const config = getEscrowConfig()
  if (!config) throw new DomainError("No escrow contract is configured on this server (MESH_ESCROW_CONTRACT_ID is not set).", 501)
  return config
}

/** Turns chain failures into responses: refusals are 422, unknown outcomes 502, missing config 501. */
function domainOf(error: unknown): never {
  if (error instanceof EscrowError) throw new DomainError(error.message, error.kind === "refused" ? 422 : error.kind === "config" ? 501 : 502)
  throw error
}

async function assertNotFrozen(orgId: string) {
  const [policy] = await getDb().select({ frozenAt: policies.frozenAt }).from(policies).where(eq(policies.orgId, orgId))
  if (policy?.frozenAt) throw new DomainError("Procurement is frozen. An owner must unfreeze it first.", 423)
}

async function loadAwarded(orgId: string, rfqId: string) {
  const [row] = await getDb()
    .select({ rfqId: rfqs.id, orderId: orders.id, orderStatus: orders.status, bidAmountCents: bids.amountCents, supplierId: suppliers.id, supplierNear: suppliers.nearAccountId })
    .from(rfqs)
    .innerJoin(orders, eq(orders.rfqId, rfqs.id))
    .innerJoin(bids, eq(bids.id, orders.bidId))
    .innerJoin(suppliers, eq(suppliers.id, bids.supplierId))
    .where(and(eq(rfqs.orgId, orgId), eq(rfqs.id, rfqId)))
  if (!row) throw new DomainError("This RFQ has no order yet. Select a supplier first.", 404)
  return row
}

async function loadMilestones(orderId: string) {
  return getDb().select().from(milestones).where(eq(milestones.orderId, orderId)).orderBy(asc(milestones.position))
}

/** Creates the default milestone plan once per order. The unique position per order makes it idempotent. */
async function ensureMilestones(orgId: string, orderId: string) {
  const existing = await loadMilestones(orderId)
  if (existing.length > 0) return existing
  await getDb().insert(milestones).values(DEFAULT_MILESTONES.map((milestone) => ({
    orgId,
    orderId,
    position: milestone.position,
    title: milestone.title,
    amountCents: 0,
    amountYocto: nearToYocto(milestone.near),
    status: "pending" as const,
  })))
  return loadMilestones(orderId)
}

const yoctoTotal = (amounts: Array<string | null>) => amounts.reduce((total, amount) => total + BigInt(amount ?? "0"), BigInt(0))

// --- Supplier account ---

export async function setSupplierNearAccount(session: Session, supplierId: string, nearAccountId: string) {
  const value = nearAccountId.trim().toLowerCase()
  if (!isNearAccountId(value)) throw new DomainError("Enter a valid NEAR account ID, for example supplier.testnet.", 400)
  const [row] = await getDb()
    .update(suppliers)
    .set({ nearAccountId: value })
    .where(and(eq(suppliers.orgId, session.orgId), eq(suppliers.id, supplierId)))
    .returning({ id: suppliers.id })
  if (!row) throw new DomainError("Supplier not found.", 404)
  await recordAudit({ ...auditFor(session), action: "supplier.near_account_set", target: supplierId, metadata: { nearAccountId: value } })
  return value
}

// --- Funding ---

/** What the owner's wallet must sign: fund_order with the milestone amounts, attaching their exact total. */
export async function getFundingPlan(session: Session, rfqId: string) {
  const config = requireEscrow()
  if (session.role !== "owner") throw new DomainError("Only an owner can fund the escrow: it is signed in the owner's wallet.", 403)
  await assertNotFrozen(session.orgId)
  const row = await loadAwarded(session.orgId, rfqId)
  if (!row.supplierNear || !isNearAccountId(row.supplierNear)) throw new DomainError("Set the supplier's NEAR account before funding this order.", 422)
  const chain = await viewEscrowConfig().catch(domainOf)
  if (!chain) throw new DomainError("The escrow contract returned no configuration.", 502)
  if (chain.frozen) throw new DomainError("The escrow contract is frozen on-chain. The owner must unfreeze it first.", 423)
  const plan = await ensureMilestones(session.orgId, row.orderId)
  const amounts = plan.map((milestone) => milestone.amountYocto ?? "0")
  const total = yoctoTotal(amounts).toString()
  await getDb().insert(settlements).values({
    orgId: session.orgId, orderId: row.orderId, idempotencyKey: fundKey(rfqId), kind: "escrow_funding",
    amountCents: 0, amountYocto: total, asset: SETTLEMENT_ROUTE.asset, chain: SETTLEMENT_ROUTE.chain, status: "pending",
  }).onConflictDoNothing()
  return {
    network: config.network,
    contractId: config.contractId,
    owner: chain.owner,
    orderId: rfqId,
    supplierNear: row.supplierNear,
    methodName: "fund_order" as const,
    args: { order_id: rfqId, supplier: row.supplierNear, milestones: amounts },
    deposit: total,
    gas: FUND_GAS,
    fundedOnChain: (await viewEscrowOrder(rfqId).catch(() => null)) !== null,
  }
}

/**
 * Records funding only after verifying, on-chain at FINAL: the transaction is the owner's successful
 * fund_order call for this order, and get_order shows this supplier, this owner and the planned amounts.
 */
export async function confirmFunding(session: Session, rfqId: string, txHash: string) {
  requireEscrow()
  const hash = txHash.trim()
  if (!isTxHash(hash)) throw new DomainError("Enter a NEAR transaction hash (base58, 43 or 44 characters).", 400)
  const row = await loadAwarded(session.orgId, rfqId)
  const db = getDb()
  const [existing] = await db.select().from(settlements).where(and(eq(settlements.orgId, session.orgId), eq(settlements.idempotencyKey, fundKey(rfqId))))
  if (existing?.status === "confirmed") {
    if (existing.confirmedTxHash === hash) return { confirmed: true, txHash: hash }
    throw new DomainError("This order's funding is already confirmed with a different transaction.", 409)
  }
  if (!row.supplierNear) throw new DomainError("Set the supplier's NEAR account before confirming funding.", 422)
  const plan = await ensureMilestones(session.orgId, row.orderId)

  try {
    const config = await viewEscrowConfig()
    if (!config) throw new DomainError("The escrow contract returned no configuration.", 502)
    await verifyFundingTx(hash, config.owner, rfqId)
    const chain = await viewEscrowOrder(rfqId)
    const mismatch = fundingMismatch(chain, { supplier: row.supplierNear, owner: config.owner, amounts: plan.map((milestone) => milestone.amountYocto ?? "0") })
    if (mismatch) throw new EscrowError(mismatch, "refused")
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Funding could not be verified."
    await recordAudit({ ...auditFor(session), action: "escrow.funding_rejected", target: row.orderId, metadata: { rfqId, txHash: hash, reason: reason.slice(0, 200) } })
    if (error instanceof DomainError) throw error
    domainOf(error)
  }

  const total = yoctoTotal(plan.map((milestone) => milestone.amountYocto)).toString()
  await db.batch([
    db.insert(settlements).values({
      orgId: session.orgId, orderId: row.orderId, idempotencyKey: fundKey(rfqId), kind: "escrow_funding",
      amountCents: 0, amountYocto: total, asset: SETTLEMENT_ROUTE.asset, chain: SETTLEMENT_ROUTE.chain, status: "pending",
    }).onConflictDoNothing(),
    db.update(settlements).set({ status: "confirmed", submittedTxHash: hash, confirmedTxHash: hash, amountYocto: total, error: null })
      .where(and(eq(settlements.orgId, session.orgId), eq(settlements.idempotencyKey, fundKey(rfqId)))),
    db.update(orders).set({ status: "in_progress" }).where(and(eq(orders.id, row.orderId), eq(orders.status, "approved"))),
  ])
  await recordAudit({ ...auditFor(session), action: "escrow.funded", target: row.orderId, metadata: { rfqId, txHash: hash, totalYocto: total } })
  return { confirmed: true, txHash: hash }
}

function fundingMismatch(chain: ChainOrder | null, expected: { supplier: string; owner: string; amounts: string[] }) {
  if (!chain) return "The escrow does not show this order yet."
  if (chain.supplier !== expected.supplier) return `The escrow pays ${chain.supplier}, not this order's supplier ${expected.supplier}.`
  if (chain.funded_by !== expected.owner) return `The escrow order was funded by ${chain.funded_by}, not the owner ${expected.owner}.`
  const amounts = chain.milestones.map((milestone) => milestone.amount)
  if (amounts.length !== expected.amounts.length || amounts.some((amount, index) => amount !== expected.amounts[index])) return "The escrow's milestone amounts do not match this order's plan."
  return null
}

// --- Payouts ---

/**
 * Releases one milestone to the supplier with the operator key. The settlement row is claimed atomically,
 * so two clicks send one transaction. The hash is stored before sending; a payout is marked paid only
 * once get_order shows it Released.
 */
export async function releaseOrderMilestone(session: Session, rfqId: string, position: number, evidenceUri: string) {
  requireEscrow()
  if (!Number.isInteger(position) || position < 0) throw new DomainError("A milestone position is required.", 400)
  const uri = typeof evidenceUri === "string" ? evidenceUri.trim() : ""
  if (!uri || uri.length > 500) throw new DomainError("Evidence is required: a link to a delivery note, invoice or photo.", 400)
  if (!isWebUrl(uri)) throw new DomainError("Evidence must be an http(s) link.", 400)
  await assertNotFrozen(session.orgId)
  const row = await loadAwarded(session.orgId, rfqId)
  const db = getDb()
  const [funding] = await db.select({ status: settlements.status }).from(settlements).where(and(eq(settlements.orgId, session.orgId), eq(settlements.idempotencyKey, fundKey(rfqId))))
  if (funding?.status !== "confirmed") throw new DomainError("This order's escrow funding is not confirmed yet.", 409)
  const [milestone] = await db.select().from(milestones).where(and(eq(milestones.orderId, row.orderId), eq(milestones.position, position)))
  if (!milestone) throw new DomainError("Milestone not found.", 404)
  if (milestone.status === "paid") throw new DomainError("This milestone is already paid.", 409)

  const key = payoutKey(rfqId, position)
  await db.insert(settlements).values({
    orgId: session.orgId, orderId: row.orderId, milestoneId: milestone.id, idempotencyKey: key, kind: "milestone_payout",
    amountCents: milestone.amountCents, amountYocto: milestone.amountYocto, asset: SETTLEMENT_ROUTE.asset, chain: SETTLEMENT_ROUTE.chain, status: "pending",
  }).onConflictDoNothing()
  const [current] = await db.select().from(settlements).where(and(eq(settlements.orgId, session.orgId), eq(settlements.idempotencyKey, key)))
  if (current.status === "submitted") return reconcilePayout(session, rfqId, row.orderId, milestone.id, position, current.id, current.submittedTxHash)

  // Atomic claim: only one request moves pending/failed -> submitted.
  const claimed = await db.update(settlements).set({ status: "submitted", submittedTxHash: null, error: null })
    .where(and(eq(settlements.id, current.id), inArray(settlements.status, ["pending", "failed"])))
    .returning({ id: settlements.id })
  if (claimed.length === 0) throw new DomainError("A payout for this milestone is already in progress or done.", 409)

  const hash = evidenceHash(uri)
  await db.batch([
    db.delete(evidence).where(eq(evidence.milestoneId, milestone.id)),
    db.insert(evidence).values({ orgId: session.orgId, milestoneId: milestone.id, kind: "uri", uri, contentHash: hash }),
    db.update(milestones).set({ status: "evidence_submitted" }).where(eq(milestones.id, milestone.id)),
  ])

  try {
    const { hash: txHash } = await releaseMilestoneOnChain({
      orderId: rfqId,
      index: position,
      evidenceHash: hash,
      onSubmit: async (submitted) => {
        await db.update(settlements).set({ submittedTxHash: submitted }).where(eq(settlements.id, current.id))
      },
    })
    return await confirmPayout(session, rfqId, row.orderId, milestone.id, position, current.id, txHash)
  } catch (error) {
    if (error instanceof DomainError) throw error
    const reason = error instanceof Error ? error.message : "The payout failed."
    if (error instanceof EscrowError && error.kind === "unknown") {
      // Leave it submitted: the next attempt reads the chain instead of paying twice.
      await db.update(settlements).set({ error: reason.slice(0, 300) }).where(eq(settlements.id, current.id))
      await recordAudit({ ...auditFor(session), action: "escrow.release_unknown", target: milestone.id, metadata: { rfqId, position, reason: reason.slice(0, 200) } })
      throw new DomainError(reason, 502)
    }
    await db.batch([
      db.update(settlements).set({ status: "failed", error: reason.slice(0, 300) }).where(eq(settlements.id, current.id)),
      db.update(milestones).set({ status: "pending" }).where(eq(milestones.id, milestone.id)),
    ])
    await recordAudit({ ...auditFor(session), action: "escrow.release_failed", target: milestone.id, metadata: { rfqId, position, reason: reason.slice(0, 200) } })
    domainOf(error)
  }
}

/** Marks a payout paid only if get_order shows the milestone Released. */
async function confirmPayout(session: Session, rfqId: string, orderId: string, milestoneId: string, position: number, settlementId: string, txHash: string) {
  const db = getDb()
  const chain = await viewEscrowOrder(rfqId).catch(domainOf)
  if (chain?.milestones[position]?.status !== "Released") {
    await db.update(settlements).set({ error: "Sent, but the escrow does not show the milestone as released yet." }).where(eq(settlements.id, settlementId))
    throw new DomainError("The payout was sent, but the escrow does not show it as released yet. Retry to check the chain.", 502)
  }
  await db.batch([
    db.update(settlements).set({ status: "confirmed", confirmedTxHash: txHash, error: null }).where(eq(settlements.id, settlementId)),
    db.update(milestones).set({ status: "paid" }).where(eq(milestones.id, milestoneId)),
  ])
  const remaining = (await loadMilestones(orderId)).filter((milestone) => milestone.status !== "paid")
  if (remaining.length === 0) await db.update(orders).set({ status: "completed" }).where(eq(orders.id, orderId))
  await recordAudit({ ...auditFor(session), action: "escrow.milestone_released", target: milestoneId, metadata: { rfqId, position, txHash } })
  return { released: true, txHash }
}

/** A previous attempt was sent but its outcome was not recorded: read the chain to settle it. */
async function reconcilePayout(session: Session, rfqId: string, orderId: string, milestoneId: string, position: number, settlementId: string, submittedTxHash: string | null) {
  const db = getDb()
  const chain = await viewEscrowOrder(rfqId).catch(domainOf)
  const status = chain?.milestones[position]?.status
  if (status === "Released" && submittedTxHash && (await operatorTxSucceeded(submittedTxHash))) {
    return confirmPayout(session, rfqId, orderId, milestoneId, position, settlementId, submittedTxHash)
  }
  if (status === "Releasing" || status === "Released") throw new DomainError("This payout is still settling on-chain. Retry in a few seconds.", 409)
  // Pending on-chain: the earlier attempt never took effect, so it can be retried.
  await db.batch([
    db.update(settlements).set({ status: "failed", error: "The earlier attempt did not take effect on-chain." }).where(eq(settlements.id, settlementId)),
    db.update(milestones).set({ status: "pending" }).where(eq(milestones.id, milestoneId)),
  ])
  throw new DomainError("The earlier attempt did not take effect on-chain. Release again to retry.", 409)
}

// --- Freeze ---

/** The operator freezes the contract too. Unfreezing on-chain is the owner's, in their wallet. */
export async function freezeEscrowOnChain(session: Session) {
  if (!getEscrowConfig()) return { skipped: true as const }
  try {
    const { hash } = await freezeOnChain()
    await recordAudit({ ...auditFor(session), action: "escrow.frozen", metadata: { txHash: hash } })
    return { ok: true as const, txHash: hash }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The on-chain freeze failed."
    await recordAudit({ ...auditFor(session), action: "escrow.freeze_failed", metadata: { reason: reason.slice(0, 200) } })
    return { ok: false as const, error: reason }
  }
}

// --- View ---

const txView = (row: { status: ChainTxView["status"]; confirmedTxHash: string | null; submittedTxHash: string | null; error: string | null }): ChainTxView =>
  ({ status: row.status, txHash: row.status === "confirmed" ? row.confirmedTxHash : null, submittedTxHash: row.submittedTxHash, error: row.error })

/** The order's escrow, from Mesh's records plus a live get_order read. Null without a contract or an order. */
export async function getEscrowViewForOrder(orgId: string, rfqId: string): Promise<EscrowView | null> {
  const config = getEscrowConfig()
  if (!config) return null
  const row = await loadAwarded(orgId, rfqId).catch(() => null)
  if (!row) return null
  const db = getDb()
  const plan = await loadMilestones(row.orderId)
  const rows = await db.select().from(settlements).where(eq(settlements.orderId, row.orderId))
  const evidenceRows = plan.length ? await db.select().from(evidence).where(inArray(evidence.milestoneId, plan.map((milestone) => milestone.id))) : []
  let chainError: string | null = null
  const chain = await viewEscrowOrder(rfqId).catch((error: unknown) => {
    chainError = error instanceof Error ? error.message : "Could not read the escrow contract."
    return null
  })
  const fund = rows.find((entry) => entry.kind === "escrow_funding")

  const milestonesOut: EscrowMilestoneView[] = plan.map((milestone) => {
    const payout = rows.find((entry) => entry.kind === "milestone_payout" && entry.milestoneId === milestone.id)
    return {
      id: milestone.id,
      position: milestone.position,
      title: milestone.title,
      amountYocto: milestone.amountYocto ?? "0",
      amountCents: milestone.amountCents,
      status: milestone.status,
      onChainStatus: chain?.milestones[milestone.position]?.status ?? null,
      payout: payout ? txView(payout) : null,
      evidenceUri: evidenceRows.find((entry) => entry.milestoneId === milestone.id)?.uri ?? null,
    }
  })

  return {
    network: config.network,
    contractId: config.contractId,
    explorerUrl: config.explorerUrl,
    supplierId: row.supplierId,
    supplierAccountId: row.supplierNear,
    onChain: chain !== null,
    chainError,
    funding: fund ? { ...txView(fund), amountYocto: fund.amountYocto } : null,
    milestones: milestonesOut,
  }
}

export const getEscrowView = (session: Session, rfqId: string) => getEscrowViewForOrder(session.orgId, rfqId)
