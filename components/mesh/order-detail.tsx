"use client"

import Link from "next/link"
import { IconCheck, IconChevronLeft, IconCircle, IconMessageCircle } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { SimulatedNote } from "@/components/mesh/parts"
import { completedSteps, TIMELINE_STEPS } from "@/lib/mesh-data"

export function OrderDetail({ id }: { id: string }) {
  const { pipeline, setSelectedAgent } = useMesh()
  const order = pipeline.find((item) => item.id === id)

  if (!order) {
    return (
      <div className="mx-auto max-w-[900px] px-3 pb-16 pt-14 lg:px-6">
        <Link href="/orders" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><IconChevronLeft size={14} /> Orders</Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-[-0.05em]">Order {id} not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">Orders are held in browser memory, so a refresh clears orders you created this session.</p>
      </div>
    )
  }

  const done = completedSteps(order.status)
  return (
    <div className="mx-auto max-w-[900px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <Link href="/orders" className="editorial-reveal inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><IconChevronLeft size={14} /> Orders</Link>
      <div className="editorial-reveal mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-foreground/10 pb-8">
        <div>
          <p className="eyebrow">{order.id}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.06em]">{order.resource}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{order.quantity.toLocaleString()} {order.unit} · {order.destination} · due {order.deadline} · budget ${order.maxBudget.toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2"><Badge variant={order.status === "Settled" ? "default" : "secondary"}>{order.status}</Badge><Link href="/" onClick={() => setSelectedAgent("head")} className={buttonVariants({ variant: "outline", size: "sm" })}><IconMessageCircle size={15} /> Ask Head agent</Link></div>
      </div>
      <SimulatedNote>Timeline progress is derived from the order status; no on-chain or supplier events back these steps yet.</SimulatedNote>
      <ol className="editorial-reveal mt-8">
        {TIMELINE_STEPS.map((step, index) => {
          const complete = index < done
          const current = index === done
          return (
            <li key={step} className="relative flex gap-4 pb-6 last:pb-0">
              {index < TIMELINE_STEPS.length - 1 && <span className={`absolute left-[11px] top-6 h-full w-px ${complete ? "bg-primary" : "bg-foreground/10"}`} />}
              <span className={`relative grid size-6 shrink-0 place-items-center rounded-full border ${complete ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary text-primary" : "border-foreground/15 text-muted-foreground"}`}>{complete ? <IconCheck size={13} /> : <IconCircle size={8} />}</span>
              <div className="pt-0.5"><p className={`text-sm ${complete || current ? "font-medium" : "text-muted-foreground"}`}>{step}</p>{current && <p className="mt-0.5 text-[11px] text-primary">In progress</p>}</div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
