"use client"

import Link from "next/link"
import { IconCircleDot, IconPlus } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { PageHeader } from "@/components/mesh/parts"
import { rfqRef, STATUS_LABEL, usd, type OrderRow } from "@/lib/rfq"

export function OrderRows({ orders }: { orders: OrderRow[] }) {
  return orders.map((item) => (
    <Link key={item.id} href={`/orders/${item.id}`} className="grid gap-3 border-b border-foreground/8 px-5 py-5 transition-colors last:border-0 hover:bg-accent/25 md:grid-cols-[1.1fr_1.7fr_0.8fr_0.8fr_1fr] md:items-center">
      <div><span className="font-mono text-xs font-medium">{rfqRef(item.id)}</span><span className="mt-1 block text-[11px] text-muted-foreground">Due {item.deadline}</span></div>
      <div><span className="text-sm font-medium">{item.resource}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.quantity.toLocaleString()} {item.unit} · {item.destination}</span></div>
      <span className="font-mono text-xs">{usd(item.maxBudgetCents)}</span>
      <span><Badge variant={item.status === "awarded" ? "default" : "secondary"}><IconCircleDot size={10} /> {STATUS_LABEL[item.status]}</Badge></span>
      <span className="text-right text-xs text-muted-foreground">{item.supplier ?? `${item.bidCount} ${item.bidCount === 1 ? "bid" : "bids"}`}</span>
    </Link>
  ))
}

export function OrdersEmpty() {
  return <p className="px-5 py-10 text-center text-sm text-muted-foreground">No orders yet. Create one here, or ask the Head Agent to draft an RFQ.</p>
}

export function OrdersView({ orders }: { orders: OrderRow[] }) {
  const { setModalOpen } = useMesh()
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Orders" title="Every RFQ," muted="end to end.">Open an order to record bids and select a supplier.</PageHeader>
      <div className="mt-8 flex justify-end"><Button onClick={() => setModalOpen(true)}><IconPlus size={16} /> New purchase order</Button></div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-foreground/10 bg-card/55 backdrop-blur-xl">
        {orders.length === 0 ? <OrdersEmpty /> : <OrderRows orders={orders} />}
      </div>
    </div>
  )
}
