"use client"

import { Button } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { PageHeader, SettlementRow, SimulatedNote } from "@/components/mesh/parts"

export function SettlementsView() {
  const { pipeline, simulateIntent } = useMesh()
  const settled = pipeline.filter((item) => item.status === "Settled")
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Settlement operations" title="Move value" muted="cleanly.">Track NEAR Intents, chain signatures and milestone payouts.</PageHeader>
      <SimulatedNote>No settlement is confirmed on-chain. Hashes and routes below are local placeholders until a testnet contract and finality queries exist.</SimulatedNote>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="glass-panel rounded-2xl p-6">
          <p className="eyebrow">Settled orders (simulated)</p>
          {settled.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">None yet.</p> : settled.map((order) => (
            <div key={order.id} className="mt-4 flex items-center justify-between border-b border-foreground/10 pb-3 text-sm last:border-0"><span>{order.id} · {order.supplier}</span><span className="font-mono">${order.spend.toLocaleString()}</span></div>
          ))}
          <Button className="mt-5" variant="outline" size="sm" onClick={simulateIntent}>Simulate Intent</Button>
        </div>
        <div className="glass-panel rounded-2xl p-6">
          <p className="eyebrow">Settlement mix (illustrative)</p>
          <div className="mt-6 space-y-5"><SettlementRow label="NEAR" detail="Native settlement" share="82%" /><SettlementRow label="Ethereum" detail="USDC liquidity" share="11%" /><SettlementRow label="Solana" detail="Supplier payouts" share="7%" /></div>
        </div>
      </div>
    </div>
  )
}
