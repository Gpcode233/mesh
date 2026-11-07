/** Shared by client and server: validation, display helpers and view types. No server imports. */

export type RfqDraft = {
  resource: string
  quantity: number
  unit: string
  /** Whole USD amount as entered; stored as cents once approved. */
  maxBudget: number
  /** YYYY-MM-DD */
  deadline: string
  destination: string
}

export type ApprovalStatus = "pending" | "approved" | "rejected"

export type ApprovalView = {
  id: string
  status: ApprovalStatus
  draft: RfqDraft
  resultId: string | null
}

export type RfqStatus = "draft" | "sourcing" | "bidding" | "awarded" | "cancelled"

export type OrderRow = {
  id: string
  resource: string
  quantity: number
  unit: string
  maxBudgetCents: number
  deadline: string
  destination: string
  status: RfqStatus
  bidCount: number
  supplier: string | null
}

export type BidView = {
  id: string
  supplier: string
  region: string | null
  amountCents: number
  leadTimeDays: number | null
  status: "submitted" | "selected" | "rejected"
}

export type OrderDetailView = OrderRow & {
  bids: BidView[]
  requiredBidCount: number
  orderStatus: string | null
}

export type SupplierView = {
  id: string
  name: string
  region: string | null
  verificationStatus: "unverified" | "verified" | "rejected"
  bidCount: number
}

export type PolicyView = {
  dailySpendLimit: number
  perOrderLimit: number
  approvalThreshold: number
  requiredBidCount: number
  approvedRegions: string[]
  requiredDocuments: string[]
  approvedAssets: string[]
  approvedChains: string[]
  agentKeyExpiryHours: number
  freezeBehavior: string
}

export const rfqRef = (id: string) => `RFQ-${id.slice(0, 8).toUpperCase()}`

export const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)

export const STATUS_LABEL: Record<RfqStatus, string> = {
  draft: "Draft",
  sourcing: "Sourcing",
  bidding: "Bidding",
  awarded: "Awarded",
  cancelled: "Cancelled",
}

export const todayUtc = () => new Date().toISOString().slice(0, 10)

const MAX_AMOUNT = 1_000_000_000

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null
}

export function isPositiveAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT
}

export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * The one RFQ validator, used for operator forms and for model tool arguments.
 * Model output is untrusted: nothing is defaulted, so missing fields are reported rather than guessed.
 */
export function parseRfqDraft(input: unknown): { ok: true; draft: RfqDraft } | { ok: false; error: string } {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  const resource = text(value.resource, 200)
  if (!resource) return { ok: false, error: "A resource is required." }
  if (!isPositiveAmount(value.quantity)) return { ok: false, error: "Quantity must be a number greater than zero." }
  const unit = text(value.unit, 32)
  if (!unit) return { ok: false, error: "A unit is required." }
  if (!isPositiveAmount(value.maxBudget)) return { ok: false, error: "Max budget must be a number greater than zero." }
  if (typeof value.deadline !== "string" || !isValidDate(value.deadline)) return { ok: false, error: "Deadline must be a date in YYYY-MM-DD format." }
  if (value.deadline < todayUtc()) return { ok: false, error: "Deadline cannot be in the past." }
  const destination = text(value.destination, 200)
  if (!destination) return { ok: false, error: "A destination is required." }
  return { ok: true, draft: { resource, quantity: value.quantity, unit, maxBudget: value.maxBudget, deadline: value.deadline, destination } }
}
