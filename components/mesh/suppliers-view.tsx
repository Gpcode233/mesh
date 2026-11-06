import { PageHeader, SimulatedNote } from "@/components/mesh/parts"
import { suppliers } from "@/lib/mesh-data"

export function SuppliersView() {
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Supplier network" title="Know who" muted="delivers.">Verified suppliers, performance signals and agent-ready counterparties.</PageHeader>
      <SimulatedNote>Example suppliers. No live supplier discovery or verification exists yet.</SimulatedNote>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {suppliers.map((supplier) => (
          <div key={supplier.name} className="glass-panel rounded-2xl p-5">
            <div className="flex items-start justify-between"><div><h2 className="font-medium">{supplier.name}</h2><p className="text-[11px] text-muted-foreground">{supplier.region}</p></div><span className="font-mono text-lg text-primary">{supplier.score}</span></div>
            <p className="mt-3 text-xs text-muted-foreground">{supplier.metric}</p>
            <p className="mt-3 border-t border-foreground/10 pt-3 text-xs">Documents: {supplier.docs}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
