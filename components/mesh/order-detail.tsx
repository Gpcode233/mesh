"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconCheck, IconChevronLeft, IconCircle, IconCoins, IconExternalLink, IconFileInvoice, IconGavel, IconMessageCircle, IconScale, IconTrophy, IconWallet } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { formatTime } from "@/components/mesh/parts"
import { formatYocto } from "@/lib/near-amount"
import { missingDocuments, regionAllowed, rfqRef, STATUS_LABEL, usd, type EscrowView, type OrderDetailView, type OrderEventView } from "@/lib/rfq"

/**
 * Progress: 1 RFQ, 2 bids, 3 supplier selected, 4 escrow funded, 5 all milestones paid.
 */
const PHASES = [
  { label: "RFQ created", steps: "RFQ created" },
  { label: "Bids received", steps: "Suppliers discovered, bids received" },
  { label: "Supplier selected", steps: "Supplier selected, mandate approved" },
  { label: "Escrow funded", steps: "Order funded on NEAR escrow" },
  { label: "Milestones paid", steps: "Evidence verified, milestones released on-chain" },
] as const

function phasesDone(order: OrderDetailView) {
  if (order.escrow?.funding?.status === "confirmed" && order.escrow.milestones.length > 0 && order.escrow.milestones.every((m) => m.status === "paid")) return 5
  if (order.escrow?.funding?.status === "confirmed") return 4
  if (order.orderStatus) return 3
  return order.bidCount > 0 ? 2 : 1
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const result = (await response.json().catch(() => ({}))) as { error?: string }
  if (response.ok) return result
  throw new Error(result.error ?? "The request failed.")
}

export function OrderDetail({ order, canOperate }: { order: OrderDetailView; canOperate: boolean }) {
  const router = useRouter()
  const { setSelectedAgent } = useMesh()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const closed = order.status === "awarded" || order.status === "cancelled"

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError("")
    try {
      await action()
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request failed.")
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  function addBid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const leadTime = String(data.get("leadTimeDays") ?? "")
    void run(async () => {
      await post(`/api/rfqs/${order.id}/bids`, {
        supplier: data.get("supplier"),
        amount: Number(data.get("amount")),
        region: data.get("region"),
        documents: data.getAll("documents"),
        leadTimeDays: leadTime === "" ? null : Number(leadTime),
      })
      form.reset()
    })
  }

  return (
    <div className="mx-auto max-w-[900px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <Link href="/orders" className="editorial-reveal inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><IconChevronLeft size={14} /> Orders</Link>
      <div className="editorial-reveal mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-foreground/10 pb-8">
        <div>
          <p className="eyebrow">{rfqRef(order.id)}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em]">{order.resource}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{order.quantity.toLocaleString()} {order.unit} · {order.destination} · due {order.deadline} · budget {usd(order.maxBudgetCents)}</p>
        </div>
        <div className="flex items-center gap-2"><Badge variant={order.status === "awarded" ? "default" : "secondary"}>{STATUS_LABEL[order.status]}</Badge><Link href="/" onClick={() => setSelectedAgent("head")} className={buttonVariants({ variant: "outline", size: "sm" })}><IconMessageCircle size={15} /> Ask Head agent</Link></div>
      </div>

      <SummaryCards order={order} />
      <PhaseStepper done={phasesDone(order)} />

      {order.status === "awarded" && <EscrowPanel order={order} canOperate={canOperate} />}

      <section className="editorial-reveal mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Bids</h2>
          <p className="text-xs text-muted-foreground">{order.bidCount} of {order.requiredBidCount} required by policy</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Entered by operators. Supplier details and documents are operator-attested, not verified.</p>
        {order.frozen && !closed && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">Procurement is frozen. No supplier can be selected until an owner unfreezes it on the Overview.</p>}
        {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3 overflow-hidden rounded-2xl border border-foreground/10 bg-card/55">
          {order.bids.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No bids recorded yet.</p>}
          {order.bids.map((bid) => (
            <div key={bid.id} data-testid="bid-row" className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/8 px-5 py-4 last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">{bid.supplier}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{[bid.region, bid.leadTimeDays === null ? null : `${bid.leadTimeDays} day lead time`, bid.nearAccountId].filter(Boolean).join(" · ") || "No details"}</p>
                <PolicyFlags order={order} bid={bid} />
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{usd(bid.amountCents)}</span>
                {bid.amountCents > order.maxBudgetCents && <Badge variant="destructive">Over budget</Badge>}
                {bid.status === "selected" && <Badge>Selected</Badge>}
                {bid.status === "rejected" && <Badge variant="outline">Not selected</Badge>}
                {!closed && canOperate && (confirming === bid.id
                  ? <Button size="sm" disabled={busy} onClick={() => run(() => post(`/api/rfqs/${order.id}/select`, { bidId: bid.id }))}>Confirm {bid.supplier}</Button>
                  : <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(bid.id)}>Select</Button>)}
              </div>
            </div>
          ))}
        </div>
        {!closed && canOperate && (
          <form onSubmit={addBid} className="glass-panel mt-4 grid gap-3 rounded-2xl p-4 sm:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto] sm:items-end">
            <BidField label="Supplier" name="supplier" required />
            <BidField label="Amount (USD)" name="amount" type="number" step="0.01" min="0.01" required />
            <BidField label="Region" name="region" />
            <BidField label="Lead days" name="leadTimeDays" type="number" min="0" />
            <Button type="submit" disabled={busy}>Record bid</Button>
            {order.requiredDocuments.length > 0 && (
              <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground sm:col-span-full">
                <legend className="sr-only">Documents on file</legend>
                <span aria-hidden className="font-medium">Documents on file:</span>
                {order.requiredDocuments.map((document) => (
                  <label key={document} className="inline-flex items-center gap-1.5 text-foreground"><input type="checkbox" name="documents" value={document} className="size-3.5 accent-primary" />{document}</label>
                ))}
              </fieldset>
            )}
          </form>
        )}
      </section>

      <section className="editorial-reveal mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">From the audit log, oldest first. Refusals are recorded too.</p>
        <ActivityTimeline events={order.events} />
      </section>
    </div>
  )
}

type FundingPlan = {
  network: string
  contractId: string
  owner: string
  methodName: "fund_order"
  args: Record<string, unknown>
  deposit: string
  gas: string
  fundedOnChain: boolean
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const result = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? "The request failed.")
  return result
}

const txLink = (escrow: EscrowView, hash: string) => `${escrow.explorerUrl}/txns/${hash}`

/**
 * The order's NEAR escrow. The owner funds it from their own wallet (or pastes the hash of a CLI
 * transaction); the server verifies funding on-chain and releases milestones with its restricted key.
 */
function EscrowPanel({ order, canOperate }: { order: OrderDetailView; canOperate: boolean }) {
  const router = useRouter()
  const { wallet, connect, operator } = useMesh()
  const escrow = order.escrow
  const [near, setNear] = useState(escrow?.supplierAccountId ?? "")
  const [hash, setHash] = useState("")
  const [evidence, setEvidence] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const isOwner = operator.role === "owner"

  if (!escrow) {
    return (
      <section className="editorial-reveal mt-8 rounded-2xl border border-foreground/10 bg-card/55 p-5">
        <h2 className="text-lg font-semibold tracking-tight">Escrow settlement</h2>
        <p className="mt-2 text-sm text-muted-foreground">No escrow contract is configured on this server. Set <code>MESH_ESCROW_CONTRACT_ID</code> and <code>MESH_NEAR_OPERATOR_PRIVATE_KEY</code> to enable on-chain funding and payouts.</p>
      </section>
    )
  }
  const view = escrow

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label); setErr(""); setMsg("")
    try { setMsg(await fn()); router.refresh() } catch (e) { setErr(e instanceof Error ? e.message : "The request failed.") } finally { setBusy(null) }
  }

  const saveNear = () => run("near", async () => {
    await post(`/api/suppliers/${view.supplierId}/near`, { nearAccountId: near })
    return "Supplier NEAR account saved."
  })

  const confirm = (txHash: string) => post(`/api/rfqs/${order.id}/escrow/fund`, { txHash })

  const fund = () => run("fund", async () => {
    const plan = await getJson<FundingPlan>(`/api/rfqs/${order.id}/escrow`)
    const signer = wallet?.accountId ? wallet : await connect()
    if (!signer?.accountId) throw new Error("Connect the owner's NEAR wallet to sign the funding.")
    if (signer.accountId !== plan.owner) throw new Error(`The escrow owner is ${plan.owner}, but the connected wallet is ${signer.accountId}. Connect the owner's wallet.`)
    const { transactionHash } = await signer.signAndSendTransaction({ contractId: plan.contractId, methodName: plan.methodName, args: plan.args, gas: plan.gas, deposit: plan.deposit })
    if (!transactionHash) throw new Error("The wallet did not return a transaction hash. If it was sent, paste its hash below.")
    await confirm(transactionHash)
    return "Escrow funding verified on-chain."
  })

  const confirmHash = () => run("hash", async () => {
    await confirm(hash)
    setHash("")
    return "Escrow funding verified on-chain."
  })

  const release = (position: number) => run(`rel-${position}`, async () => {
    await post(`/api/rfqs/${order.id}/escrow/release`, { position, evidenceUri: evidence[position] ?? "" })
    return "Milestone released and confirmed on-chain."
  })

  const funded = view.funding?.status === "confirmed"

  return (
    <section data-testid="escrow-panel" className="editorial-reveal mt-8 rounded-2xl border border-foreground/10 bg-card/55 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Escrow settlement</h2>
          <p className="mt-1 text-xs text-muted-foreground">NEAR {view.network} escrow. Funds sit in the contract, not with Mesh. Nothing shows as funded or paid until the chain confirms it.</p>
        </div>
        <a href={`${view.explorerUrl}/address/${view.contractId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><IconExternalLink size={13} /> {view.contractId}</a>
      </div>

      {view.chainError && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">Could not read the contract just now: {view.chainError}</p>}
      {err && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      {msg && <p role="status" className="mt-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">{msg}</p>}

      {!funded && (
        <div className="mt-4 grid gap-3 rounded-xl border border-foreground/10 bg-background/40 p-4">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Supplier NEAR account (receives payouts)
            <div className="flex gap-2">
              <input value={near} onChange={(e) => setNear(e.target.value)} placeholder="supplier.testnet" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-sm font-normal text-foreground outline-none ring-primary/40 focus:ring-2" />
              {canOperate && <Button type="button" variant="outline" size="sm" disabled={busy !== null || !near.trim() || near.trim() === view.supplierAccountId} onClick={() => void saveNear()}>Save</Button>}
            </div>
          </label>
          <p className="text-[11px] text-muted-foreground">Testnet escrow: 2 milestones of 0.05 NEAR. These are testnet amounts, not converted from the USD bid. The owner signs the funding in their own wallet; Mesh cannot fund it.</p>
          {isOwner ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void connect()}><IconWallet size={14} /> {wallet?.accountId ? `Wallet: ${wallet.accountId}` : "Connect wallet"}</Button>
                <Button type="button" size="sm" disabled={busy !== null || !view.supplierAccountId} onClick={() => void fund()}><IconCoins size={14} /> {busy === "fund" ? "Waiting for the wallet…" : "Fund escrow"}</Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid min-w-0 flex-1 gap-1.5 text-[11px] font-medium text-muted-foreground">Funded from the CLI? Paste the transaction hash
                  <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="e.g. 6LhQgu3EHzzK7eRK1WQpPfDXVy7j7mXuGPPRjM6ASj36" className="h-9 rounded-lg border border-border bg-card px-3 font-mono text-xs font-normal text-foreground outline-none ring-primary/40 focus:ring-2" />
                </label>
                <Button type="button" variant="outline" size="sm" disabled={busy !== null || !hash.trim()} onClick={() => void confirmHash()}>{busy === "hash" ? "Verifying…" : "Verify funding"}</Button>
              </div>
            </>
          ) : <p className="text-[11px] text-muted-foreground">Waiting for an owner to fund the escrow.</p>}
          {view.funding?.status === "failed" && view.funding.error && <p className="text-[11px] text-destructive">{view.funding.error}</p>}
        </div>
      )}

      {funded && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm font-medium text-primary">Escrow funded on-chain{view.funding?.amountYocto ? ` · ${formatYocto(view.funding.amountYocto)}` : ""}</p>
          {view.funding?.txHash && <a href={txLink(view, view.funding.txHash)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"><IconExternalLink size={12} /> Funding tx {view.funding.txHash.slice(0, 12)}…</a>}
          <p className="mt-1 text-[11px] text-muted-foreground">Pays only {view.supplierAccountId}, fixed on-chain at funding.</p>
        </div>
      )}

      {view.milestones.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium">Milestones</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-foreground/10">
            {view.milestones.map((m) => (
              <div key={m.id} data-testid="milestone-row" className="grid gap-2 border-b border-foreground/8 px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{m.title} <span className="font-mono text-xs text-muted-foreground">· {formatYocto(m.amountYocto)}</span></p>
                    <p className="mt-0.5 break-all text-[11px] text-muted-foreground">{m.status === "paid" ? "Released on-chain" : funded ? `On-chain: ${m.onChainStatus ?? "unknown"}` : "Awaiting funding"}{m.evidenceUri ? ` · evidence ${m.evidenceUri}` : ""}</p>
                    {m.payout?.txHash && <a href={txLink(view, m.payout.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><IconExternalLink size={11} /> Payout tx {m.payout.txHash.slice(0, 12)}…</a>}
                    {m.payout && m.payout.status !== "confirmed" && m.payout.error && <p className="text-[11px] text-destructive">{m.payout.status === "submitted" ? "Outcome not confirmed yet: " : "Last attempt failed: "}{m.payout.error}</p>}
                  </div>
                  {m.status === "paid" ? <Badge>Paid</Badge> : !(funded && canOperate) && <Badge variant="outline">{funded ? "Pending" : "Locked"}</Badge>}
                </div>
                {m.status !== "paid" && funded && canOperate && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input aria-label={`Evidence for ${m.title}`} value={evidence[m.position] ?? ""} onChange={(e) => setEvidence({ ...evidence, [m.position]: e.target.value })} placeholder="Evidence link: delivery note, invoice or photo (https://…)" className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-xs outline-none ring-primary/40 focus:ring-2" />
                    <Button size="sm" variant="outline" disabled={busy !== null || !(evidence[m.position] ?? "").trim() || order.frozen} onClick={() => void release(m.position)}>{busy === `rel-${m.position}` ? "Releasing…" : "Release milestone"}</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {funded && canOperate && <p className="mt-2 text-[11px] text-muted-foreground">Released by the server&apos;s restricted key: it can only pay {view.supplierAccountId}, within the daily cap, before the mandate expires. The evidence link&apos;s sha256 hash is recorded on-chain.</p>}
        </div>
      )}
    </section>
  )
}

/** What policy would refuse about this bid's supplier, shown before anyone tries to select it. */
function PolicyFlags({ order, bid }: { order: OrderDetailView; bid: OrderDetailView["bids"][number] }) {
  if (bid.status !== "submitted") return null
  const missing = missingDocuments(order.requiredDocuments, bid.documents)
  const regionOk = regionAllowed(order.approvedRegions, bid.region)
  if (regionOk && missing.length === 0) return null
  return (
    <p className="mt-1 text-[11px] text-destructive">
      {[!regionOk && (bid.region ? `Region ${bid.region} not approved` : "No region on record"), missing.length > 0 && `Missing ${missing.join(", ")}`].filter(Boolean).join(" · ")}
    </p>
  )
}

function BidField({ label, ...props }: { label: string } & React.ComponentProps<"input">) {
  return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{label}<input {...props} className="h-9 min-w-0 rounded-lg border border-border bg-card px-3 text-sm font-normal text-foreground outline-none ring-primary/40 focus:ring-2" /></label>
}

function SummaryCards({ order }: { order: OrderDetailView }) {
  const best = order.bids.reduce<OrderDetailView["bids"][number] | null>((low, bid) => (!low || bid.amountCents < low.amountCents ? bid : low), null)
  const diff = best ? order.maxBudgetCents - best.amountCents : 0
  const missing = Math.max(0, order.requiredBidCount - order.bidCount)
  return (
    <div className="editorial-reveal mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card icon={<IconFileInvoice size={15} />} label="Budget" value={usd(order.maxBudgetCents)} detail={`${order.quantity.toLocaleString()} ${order.unit}, due ${order.deadline}`} />
      <Card icon={<IconScale size={15} />} label="Best bid" value={best ? usd(best.amountCents) : "—"} detail={!best ? "No bids yet" : diff >= 0 ? `${usd(diff)} under budget · ${best.supplier}` : `${usd(-diff)} over budget · ${best.supplier}`} tone={best && diff < 0 ? "alert" : "default"} />
      <Card icon={<IconGavel size={15} />} label="Bids" value={`${order.bidCount} / ${order.requiredBidCount}`} detail={missing ? `${missing} more needed by policy` : "Policy bid count met"} tone={missing ? "default" : "good"} />
      <Card icon={<IconTrophy size={15} />} label="Selected supplier" value={order.awardedCents === null ? "—" : usd(order.awardedCents)} detail={order.supplier ? `${order.supplier}${order.escrow?.funding?.status === "confirmed" ? " · escrow funded" : " · not funded yet"}` : "Nobody selected yet"} tone={order.supplier ? "good" : "default"} />
    </div>
  )
}

function Card({ icon, label, value, detail, tone = "default" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: "default" | "good" | "alert" }) {
  return (
    <div className="glass-panel rounded-2xl p-4">
      <p className="flex items-center gap-1.5 text-muted-foreground"><span className="text-primary">{icon}</span><span className="eyebrow">{label}</span></p>
      <p className="mt-3 font-mono text-2xl font-semibold tracking-tight">{value}</p>
      <p className={`mt-1 truncate text-[11px] ${tone === "alert" ? "text-destructive" : tone === "good" ? "text-primary" : "text-muted-foreground"}`}>{detail}</p>
    </div>
  )
}

function PhaseStepper({ done }: { done: number }) {
  return (
    <ol aria-label="Order progress" className="editorial-reveal mt-6 grid grid-cols-5 gap-1 rounded-2xl border border-foreground/10 bg-card/55 px-3 py-4">
      {PHASES.map((phase, index) => {
        const complete = index < done
        const current = index === done
        return (
          <li key={phase.label} title={phase.steps} className="relative flex flex-col items-center text-center">
            {index > 0 && <span className={`absolute right-1/2 top-3 h-px w-full ${complete ? "bg-primary" : "bg-foreground/10"}`} />}
            <span className={`relative grid size-6 place-items-center rounded-full border ${complete ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary bg-background text-primary" : "border-foreground/15 bg-background text-muted-foreground"}`}>
              {complete ? <IconCheck size={13} /> : <IconCircle size={8} />}
            </span>
            <span className={`mt-2 text-[11px] leading-4 ${complete || current ? "font-medium" : "text-muted-foreground"}`}>{phase.label}</span>
            {current && <span className="text-[10px] text-primary">Next</span>}
          </li>
        )
      })}
    </ol>
  )
}

function ActivityTimeline({ events }: { events: OrderEventView[] }) {
  if (events.length === 0) return <p className="mt-4 text-sm text-muted-foreground">No recorded activity.</p>
  return (
    <ol className="mt-4">
      {events.map((event, index) => {
        const refused = event.action === "order.blocked"
        return (
          <li key={event.id} className="relative flex gap-4 pb-5 last:pb-0">
            {index < events.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-foreground/10" />}
            <span className={`relative grid size-6 shrink-0 place-items-center rounded-full border ${refused ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-accent text-primary"}`}>
              {refused ? <span className="text-[11px] font-semibold">!</span> : <IconCheck size={12} />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-sm font-medium ${refused ? "text-destructive" : ""}`}>{event.label}</p>
              {event.detail && <p className="mt-0.5 text-xs text-muted-foreground">{event.detail}</p>}
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{formatDate(event.at)} {formatTime(event.at)}{event.actor ? ` · ${event.actor}` : ""}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(timestamp)
}