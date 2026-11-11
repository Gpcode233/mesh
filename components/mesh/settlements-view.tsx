"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { IconArrowUpRight, IconBuildingBank, IconCalendarDollar, IconLink } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { PageHeader, SimulatedNote } from "@/components/mesh/parts"
import { formatYocto } from "@/lib/near-amount"
import { rfqRef, usd, type SettlementSummary } from "@/lib/rfq"

/** Real totals from the database. NEAR figures count only transactions verified on-chain at FINAL. */
export function SettlementsView({ summary }: { summary: SettlementSummary }) {
  const used = summary.dailyLimitCents > 0 ? Math.min(1, summary.committedTodayCents / summary.dailyLimitCents) : 0
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Settlement operations" title="Move value" muted="cleanly.">What has been committed, and what is waiting to be paid.</PageHeader>
      <SimulatedNote>Escrow runs on NEAR testnet with testnet NEAR: the owner funds an order from their wallet, and the server releases milestones with a restricted key. NEAR figures count only transactions verified on-chain. NEAR Intents and stablecoins are not built.</SimulatedNote>

      <div className="editorial-reveal mt-6 grid gap-4 md:grid-cols-3">
        <SummaryCard icon={<IconCalendarDollar size={16} />} label="Committed today" value={usd(summary.committedTodayCents)} detail={`of ${usd(summary.dailyLimitCents)} daily limit · ${usd(Math.max(0, summary.dailyLimitCents - summary.committedTodayCents))} left`}>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Daily limit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)}>
            <div className={`h-full rounded-full ${used >= 0.9 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${used * 100}%` }} />
          </div>
        </SummaryCard>
        <SummaryCard icon={<IconBuildingBank size={16} />} label="Approved orders" value={usd(summary.awardedCents)} detail={`${summary.awardedCount} ${summary.awardedCount === 1 ? "order" : "orders"} with a selected supplier`} />
        <SummaryCard
          icon={<IconLink size={16} />}
          label="Paid on-chain"
          value={formatYocto(summary.paidYocto)}
          detail={`${summary.paidCount} milestone ${summary.paidCount === 1 ? "payout" : "payouts"} · ${formatYocto(summary.escrowedYocto)} escrowed across ${summary.escrowedCount} ${summary.escrowedCount === 1 ? "order" : "orders"}`}
        />
      </div>

      <section className="editorial-reveal mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Awaiting escrow funding</h2>
          <p className="text-xs text-muted-foreground">{summary.awaiting.length} {summary.awaiting.length === 1 ? "order" : "orders"}</p>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-foreground/10 bg-card/55">
          {summary.awaiting.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">No approved orders yet. Select a supplier on an RFQ to create one.</p>}
          {summary.awaiting.map((row) => (
            <Link key={row.rfqId} href={`/orders/${row.rfqId}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/8 px-5 py-4 transition-colors last:border-0 hover:bg-accent/25">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.resource}</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{rfqRef(row.rfqId)} · {row.supplier} · approved {new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(row.approvedAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{usd(row.amountCents)}</span>
                <Badge variant="outline">Not settled</Badge>
                <IconArrowUpRight size={15} className="text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function SummaryCard({ icon, label, value, detail, children }: { icon: ReactNode; label: string; value: string; detail: string; children?: ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-5">
      <p className="flex items-center gap-2 text-muted-foreground"><span className="text-primary">{icon}</span><span className="eyebrow">{label}</span></p>
      <p className="mt-4 font-mono text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
      {children}
    </div>
  )
}
