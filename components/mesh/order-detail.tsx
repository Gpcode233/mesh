"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconCheck, IconChevronLeft, IconCircle, IconMessageCircle } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { rfqRef, STATUS_LABEL, usd, type OrderDetailView } from "@/lib/rfq"

const STEPS = [
  "RFQ created",
  "Suppliers discovered",
  "Bids received",
  "Supplier selected",
  "Mandate approved",
  "Intent submitted",
  "Payment routed",
  "Evidence verified",
  "Milestone paid",
  "Order completed",
] as const

/** Only states backed by stored records count as done; steps after supplier selection are not built yet. */
function completedSteps(order: OrderDetailView) {
  if (order.orderStatus) return 4
  return order.bidCount > 0 ? 3 : 1
}
const LAST_BUILT_STEP = 4

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (response.ok) return
  const result = (await response.json().catch(() => ({}))) as { error?: string }
  throw new Error(result.error ?? "The request failed.")
}

export function OrderDetail({ order, canOperate }: { order: OrderDetailView; canOperate: boolean }) {
  const router = useRouter()
  const { setSelectedAgent } = useMesh()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const done = completedSteps(order)
  const closed = order.status === "awarded" || order.status === "cancelled"

  async function run(action: () => Promise<void>) {
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

      <section className="editorial-reveal mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Bids</h2>
          <p className="text-xs text-muted-foreground">{order.bidCount} of {order.requiredBidCount} required by policy</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Entered by operators. Agents do not contact suppliers yet, and supplier details are not verified.</p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3 overflow-hidden rounded-2xl border border-foreground/10 bg-card/55">
          {order.bids.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No bids recorded yet.</p>}
          {order.bids.map((bid) => (
            <div key={bid.id} data-testid="bid-row" className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/8 px-5 py-4 last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-medium">{bid.supplier}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{[bid.region, bid.leadTimeDays === null ? null : `${bid.leadTimeDays} day lead time`].filter(Boolean).join(" · ") || "No details"}</p>
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
          </form>
        )}
      </section>

      <section className="editorial-reveal mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Timeline</h2>
        <ol className="mt-4">
          {STEPS.map((step, index) => {
            const complete = index < done
            const current = index === done && index < LAST_BUILT_STEP
            const notBuilt = index >= LAST_BUILT_STEP
            return (
              <li key={step} className="relative flex gap-4 pb-6 last:pb-0">
                {index < STEPS.length - 1 && <span className={`absolute left-[11px] top-6 h-full w-px ${complete ? "bg-primary" : "bg-foreground/10"}`} />}
                <span className={`relative grid size-6 shrink-0 place-items-center rounded-full border ${complete ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary text-primary" : "border-foreground/15 text-muted-foreground"}`}>{complete ? <IconCheck size={13} /> : <IconCircle size={8} />}</span>
                <div className="pt-0.5">
                  <p className={`text-sm ${complete || current ? "font-medium" : "text-muted-foreground"}`}>{step}</p>
                  {current && <p className="mt-0.5 text-[11px] text-primary">Next</p>}
                  {notBuilt && <p className="mt-0.5 text-[11px] text-muted-foreground">Not built yet</p>}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

function BidField({ label, ...props }: { label: string } & React.ComponentProps<"input">) {
  return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{label}<input {...props} className="h-9 min-w-0 rounded-lg border border-border bg-card px-3 text-sm font-normal text-foreground outline-none ring-primary/40 focus:ring-2" /></label>
}
