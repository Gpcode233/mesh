"use client"

import Link from "next/link"
import { IconCircleDot, IconPlus } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { PageHeader, SimulatedNote } from "@/components/mesh/parts"

export function OrdersView() {
  const { pipeline, setModalOpen } = useMesh()
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Orders" title="Every RFQ," muted="end to end.">Open an order to see its lifecycle from RFQ to payout.</PageHeader>
      <div className="mt-8 flex items-center justify-between"><SimulatedNote>Orders live in browser memory only; a refresh resets them.</SimulatedNote><Button onClick={() => setModalOpen(true)}><IconPlus size={16} /> New purchase order</Button></div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-foreground/10 bg-card/55 backdrop-blur-xl">
        {pipeline.map((item) => (
          <Link key={item.id} href={`/orders/${item.id}`} className="grid gap-3 border-b border-foreground/8 px-5 py-5 transition-colors last:border-0 hover:bg-accent/25 md:grid-cols-[1fr_2fr_1fr_1fr] md:items-center">
            <div><span className="font-mono text-xs font-medium">{item.id}</span><span className="mt-1 block text-[11px] text-muted-foreground">Due {item.deadline}</span></div>
            <div><span className="text-sm font-medium">{item.resource}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.quantity.toLocaleString()} {item.unit} · {item.destination}</span></div>
            <span className="font-mono text-xs">${item.maxBudget.toLocaleString()}</span>
            <span><Badge variant={item.status === "Settled" ? "default" : "secondary"}><IconCircleDot size={10} /> {item.status}</Badge></span>
          </Link>
        ))}
      </div>
    </div>
  )
}
