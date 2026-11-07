"use client"

import { useState } from "react"
import Link from "next/link"
import {
  IconActivity, IconArrowUpRight, IconChevronDown, IconCheck, IconCode, IconCoins, IconCommand,
  IconFileInvoice, IconLock, IconMapPin, IconPlus, IconShieldCheck, IconTerminal2, IconRefresh,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { EconomyMetric, formatTime, Metric, SettlementRow, SimulatedNote, StatusRow } from "@/components/mesh/parts"
import { OrderRows, OrdersEmpty } from "@/components/mesh/orders-view"
import type { OrderRow, SupplierView } from "@/lib/rfq"

export function OverviewView({ orders, suppliers }: { orders: OrderRow[]; suppliers: SupplierView[] }) {
  const { events, wallet, isFrozen, isRevoking, setModalOpen, emergencyFreeze, simulateIntent, simulateKeyRotation } = useMesh()
  const [isTerminalOpen, setTerminalOpen] = useState(true)

  return (
    <div className="mx-auto max-w-[1440px] px-3 pb-16 pt-10 lg:px-6 lg:pt-12">
      <section className="editorial-reveal grid gap-8 border-b border-foreground/10 pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="eyebrow">Control layer / evidence</p>
          <h1 className="mt-5 max-w-3xl text-[clamp(2.6rem,6vw,5.75rem)] font-semibold leading-[0.92] tracking-[-0.075em]">Procurement that<br /><span className="text-muted-foreground">moves itself.</span></h1>
          <p className="mt-7 max-w-xl text-[15px] leading-7 text-muted-foreground">Mesh agents source, negotiate, verify, and settle your next purchase order—within the rules you set.</p>
          <SimulatedNote>Orders and suppliers are real records. Mandates, spend, guard status, economics and the activity stream are still simulated.</SimulatedNote>
        </div>
        <div className="flex items-center gap-3 lg:pb-1"><Button onClick={() => setModalOpen(true)}><IconPlus size={16} /> New purchase order</Button><Button variant="outline" size="icon" aria-label="Open command menu"><IconCommand size={17} /></Button></div>
      </section>

      <section className="editorial-reveal grid border-b border-foreground/10 md:grid-cols-4">
        <Metric label="Active mandates" value={isFrozen ? "00" : "12"} detail={isFrozen ? "Frozen by operator" : "2 expiring this week"} icon={<IconLock size={16} />} />
        <Metric label="Committed spend" value={isFrozen ? "$0" : "$42,180"} detail="82% under daily cap" icon={<IconCoins size={16} />} />
        <Metric label="Open purchase orders" value={String(orders.filter((item) => item.status === "sourcing" || item.status === "bidding").length).padStart(2, "0")} detail="Sourcing or bidding" icon={<IconFileInvoice size={16} />} />
        <Metric label="Guard status" value={isFrozen ? "Frozen" : "Healthy"} detail={isFrozen ? "Manual review required" : "Velocity nominal"} icon={<IconShieldCheck size={16} />} alert={isFrozen} />
      </section>

      <section className="editorial-reveal mt-10 grid gap-10 xl:grid-cols-[1fr_350px]">
        <div>
          <div className="mb-5 flex items-end justify-between"><div><p className="eyebrow">01 / Procurement pipeline</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">Orders in flight</h2></div><Link href="/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>All orders</Link></div>
          <div className="overflow-hidden rounded-2xl border border-foreground/10 bg-card/55 backdrop-blur-xl">
            <div className="hidden grid-cols-[1.1fr_1.7fr_0.8fr_0.8fr_1fr] border-b border-foreground/10 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid"><span>Order</span><span>Need</span><span>Budget</span><span>Status</span><span className="text-right">Agent</span></div>
            {orders.length === 0 ? <OrdersEmpty /> : <OrderRows orders={orders.slice(0, 5)} />}
          </div>
        </div>

        <aside className="rounded-2xl bg-[#141b1d] p-6 text-[#ecf3ec] shadow-[0_24px_70px_oklch(0.2_0.04_210/0.18)]">
          <div className="flex items-start justify-between"><div><p className="eyebrow text-[#93a39d]">02 / Safety control</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.04em]">Guard Watcher</h2></div><span className={`grid size-9 place-items-center rounded-full ${isFrozen ? "bg-[#f18b76]/20 text-[#f18b76]" : "bg-[#c6e8cd] text-[#31563b]"}`}><IconShieldCheck size={18} /></span></div>
          <div className="mt-8 border-y border-white/10 py-5"><div className="flex justify-between text-[11px] text-[#93a39d]"><span>Daily velocity</span><span>$42,180 / $50,000</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full bg-[#a7ddb0] transition-all duration-700 ${isFrozen ? "w-0" : "w-[84%]"}`} /></div></div>
          <div className="space-y-4 py-5 text-xs"><StatusRow label="Spending velocity" value={isFrozen ? "Paused" : "Nominal"} /><StatusRow label="Key rotation" value="Every 24h" /><StatusRow label="TEE attestation" value="Simulated" /></div>
          <Button className="mt-3 w-full bg-[#f18b76] text-[#321714] hover:bg-[#ff9d89]" onClick={emergencyFreeze} disabled={!wallet || isRevoking || isFrozen}>{isRevoking ? "Revoking keys..." : isFrozen ? "All keys revoked" : "Revoke all keys & freeze"}</Button>
          {!wallet && <p className="mt-3 text-center text-[11px] text-[#93a39d]">Connect wallet to enable emergency controls.</p>}
        </aside>
      </section>

      <section className="editorial-reveal mt-12 grid gap-10 border-t border-foreground/10 pt-10 lg:grid-cols-[1fr_0.85fr]">
        <div><p className="eyebrow">03 / Network economics</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">Value captured by execution</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Every settled order compounds the supplier graph and routes more volume through the agent economy.</p><div className="mt-7 grid grid-cols-3 gap-3"><EconomyMetric label="Routed volume" value="$1.84M" detail="+18.6%" /><EconomyMetric label="Buyer savings" value="$96.4K" detail="5.2% avg." /><EconomyMetric label="Mesh fees" value="$9.2K" detail="0.5% take" /></div></div>
        <div className="rounded-2xl border border-foreground/10 bg-card/55 p-5 backdrop-blur-xl"><div className="flex items-center justify-between"><span className="eyebrow">Settlement mix</span><span className="font-mono text-[11px] text-muted-foreground">ILLUSTRATIVE</span></div><div className="mt-6 space-y-5"><SettlementRow label="NEAR" detail="Native settlement" share="82%" /><SettlementRow label="Ethereum" detail="USDC liquidity" share="11%" /><SettlementRow label="Solana" detail="Supplier payouts" share="7%" /></div></div>
      </section>

      <section className="editorial-reveal mt-12 grid gap-10 border-t border-foreground/10 pt-10 lg:grid-cols-[1fr_0.85fr]">
        <div><div className="flex items-end justify-between"><div><p className="eyebrow">04 / Supplier intelligence</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">Who has bid</h2></div><IconMapPin size={19} className="text-primary" /></div>{suppliers.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No suppliers yet. They appear when a bid is recorded.</p>}<div className="mt-6 grid gap-3 sm:grid-cols-2">{suppliers.slice(0, 4).map((s) => <div key={s.id} className="flex items-center justify-between border-b border-foreground/10 py-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{s.name}</p><p className="mt-1 text-[11px] capitalize text-muted-foreground">{s.verificationStatus}</p></div><span className="font-mono text-sm text-primary">{s.bidCount}</span></div>)}</div></div>
        <div><div className="flex items-end justify-between"><div><p className="eyebrow">05 / Activity stream</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">Recent events</h2></div><Link href="/audit" className={buttonVariants({ variant: "ghost", size: "sm" })}>Audit log</Link></div><div className="mt-6 space-y-4">{events.slice(0, 4).map((event) => <div key={event.id} className="flex gap-3"><span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${event.level === "error" ? "bg-destructive/10 text-destructive" : "bg-accent text-primary"}`}>{event.level === "success" ? <IconCheck size={13} /> : <IconActivity size={13} />}</span><div className="min-w-0"><p className="truncate text-sm">{event.message}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{formatTime(event.timestamp)} · {event.metadata}</p></div></div>)}</div></div>
      </section>

      <section className="editorial-reveal mt-12 overflow-hidden rounded-2xl bg-[#101719] text-[#d9e3d7]">
        <button onClick={() => setTerminalOpen((open) => !open)} className="flex w-full items-center justify-between border-b border-white/10 px-5 py-4 text-left"><span className="flex items-center gap-2 text-sm"><IconTerminal2 size={16} className="text-[#9bdba5]" /> Agent operations <Badge variant="outline" className="border-white/15 text-[#9bdba5]">SIMULATED</Badge></span><IconChevronDown size={16} className={`transition-transform ${isTerminalOpen ? "rotate-180" : ""}`} /></button>
        {isTerminalOpen && <div className="grid gap-6 p-5 lg:grid-cols-[1fr_280px]"><div className="space-y-3 font-mono text-xs">{events.slice(0, 5).map((event) => <div key={event.id} className="flex gap-3"><span className="text-white/25">{formatTime(event.timestamp)}</span><span className="text-[#9bdba5]">›</span><span>{event.message} <span className="text-white/35">{event.metadata}</span></span></div>)}</div><div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="mb-4 flex items-center gap-2 text-[#9bdba5]"><IconCode size={15} /> Runtime telemetry</div><div className="space-y-3 text-xs text-white/55"><div className="flex justify-between"><span>Intent routing</span><span className="text-white/40">mock</span></div><div className="flex justify-between"><span>Chain signatures</span><span className="text-white/40">mock</span></div><div className="flex justify-between"><span>Attestation</span><span className="text-white/40">mock</span></div></div><div className="mt-5 grid gap-2"><Button variant="outline" size="xs" className="justify-start border-white/15 bg-white/5 text-[#d9e3d7] hover:bg-white/10 hover:text-white" onClick={simulateIntent}><IconArrowUpRight size={14} /> Simulate Intent</Button><Button variant="outline" size="xs" className="justify-start border-white/15 bg-white/5 text-[#d9e3d7] hover:bg-white/10 hover:text-white" onClick={simulateKeyRotation}><IconRefresh size={14} /> Rotate mandate key</Button></div></div></div>}
      </section>
    </div>
  )
}
