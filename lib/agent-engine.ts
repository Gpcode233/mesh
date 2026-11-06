import {
  revokeMandateAccessKey,
  routeStablecoinSettlement,
  type WalletProvider,
} from "@/lib/near"

export type RfqRequirement = {
  resource: string
  quantity: number
  unit: string
  maxBudget: number
  deadline: string
  destination?: string
}

export type ProcurementBid = RfqRequirement & {
  id: string
  supplier: string
  amount: number
  eta: string
  confidence: number
}

export type Milestone = {
  id: string
  label: string
  completed: boolean
  evidence?: string
}

export type AgentEvent = {
  id: string
  timestamp: number
  level: "info" | "success" | "warning" | "error"
  message: string
  metadata?: string
}

export function parseRfq(input: Partial<RfqRequirement>): RfqRequirement {
  const resource = input.resource?.trim()
  if (!resource) throw new Error("An RFQ resource is required.")
  if (!input.quantity || input.quantity <= 0) {
    throw new Error("RFQ quantity must be greater than zero.")
  }
  if (!input.maxBudget || input.maxBudget <= 0) {
    throw new Error("RFQ budget must be greater than zero.")
  }
  if (!input.deadline) throw new Error("An RFQ deadline is required.")
  return {
    resource,
    quantity: input.quantity,
    unit: input.unit?.trim() || "units",
    maxBudget: input.maxBudget,
    deadline: input.deadline,
    destination: input.destination?.trim() || "Global fulfillment",
  }
}

export function createBid(
  requirement: RfqRequirement,
  supplier: string,
  amount: number,
  eta: string
): ProcurementBid {
  if (amount <= 0 || amount > requirement.maxBudget) {
    throw new Error("Bid must be positive and within the RFQ budget.")
  }
  return {
    ...requirement,
    id: `bid-${Date.now().toString(36)}`,
    supplier,
    amount,
    eta,
    confidence: Math.min(99, Math.round(78 + (requirement.maxBudget - amount) / requirement.maxBudget * 20)),
  }
}

export class GuardWatcher {
  private readonly events: AgentEvent[] = []
  private revoked = false

  constructor(
    private readonly options: {
      dailyCap: number
      velocityWindowMs?: number
      maxWindowSpend?: number
      onRevoke?: (event: AgentEvent) => Promise<void>
    }
  ) {}

  get history() {
    return [...this.events]
  }

  async recordSpend(amount: number, at = Date.now()) {
    const windowMs = this.options.velocityWindowMs ?? 60 * 60 * 1000
    const recent = this.events
      .filter((event) => event.metadata?.startsWith("spend:"))
      .filter((event) => at - event.timestamp <= windowMs)
      .reduce((sum, event) => sum + Number(event.metadata?.slice(6) || 0), 0)
    const nextTotal = recent + amount
    const threshold = this.options.maxWindowSpend ?? this.options.dailyCap * 0.5

    if (nextTotal > this.options.dailyCap || nextTotal > threshold) {
      const event = this.add("error", "Guard Watcher breached spending velocity threshold.", `spend:${amount}`)
      await this.triggerRevocation(event)
      return { allowed: false, event }
    }

    return { allowed: true, event: this.add("info", "Spend telemetry within mandate.", `spend:${amount}`) }
  }

  async triggerRevocation(reason?: AgentEvent) {
    if (this.revoked) return
    this.revoked = true
    const event = reason ?? this.add("warning", "Agent permissions revoked by Guard Watcher.")
    await this.options.onRevoke?.(event)
  }

  private add(level: AgentEvent["level"], message: string, metadata?: string) {
    const event = { id: `event-${Date.now().toString(36)}`, timestamp: Date.now(), level, message, metadata }
    this.events.push(event)
    return event
  }
}

export async function executeProcurement(input: {
  requirement: RfqRequirement
  bid: ProcurementBid
  milestones: Milestone[]
  wallet: WalletProvider
  recipient: string
  guard: GuardWatcher
  onEvent?: (event: AgentEvent) => void
}) {
  const emit = (event: AgentEvent) => input.onEvent?.(event)
  const spend = await input.guard.recordSpend(input.bid.amount)
  emit(spend.event)
  if (!spend.allowed) throw new Error("Procurement blocked by Guard Watcher.")

  const incomplete = input.milestones.filter((milestone) => !milestone.completed)
  if (incomplete.length > 0) {
    throw new Error(`Milestone verification pending: ${incomplete[0].label}.`)
  }

  const settlement = await routeStablecoinSettlement({
    sourceChain: "near",
    destinationChain: "near",
    asset: "USDC",
    amount: input.bid.amount.toFixed(2),
    recipient: input.recipient,
    mode: "submit",
  })
  const transaction = await input.wallet.signAndSendTransaction({
    contractId: "procurement.mesh.near",
    methodName: "release_milestone_payout",
    args: { rfq: input.requirement.resource, bid_id: input.bid.id, intent_hash: settlement.intentHash },
  })
  emit({
    id: `event-${Date.now().toString(36)}`,
    timestamp: Date.now(),
    level: "success",
    message: "Milestones verified; payout released.",
    metadata: transaction.transactionHash,
  })
  return { settlement, transaction }
}

export async function revokeAgentKey(
  wallet: WalletProvider,
  publicKey: string,
  onEvent?: (event: AgentEvent) => void
) {
  const transaction = await revokeMandateAccessKey(wallet, publicKey)
  onEvent?.({
    id: `event-${Date.now().toString(36)}`,
    timestamp: Date.now(),
    level: "warning",
    message: "Mandate access key revoked.",
    metadata: transaction.transactionHash,
  })
  return transaction
}
