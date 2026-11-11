import { IconExternalLink } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/mesh/parts"
import type { SupplierView } from "@/lib/rfq"

export function SuppliersView({ suppliers }: { suppliers: SupplierView[] }) {
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Supplier network" title="Know who" muted="delivers.">Suppliers appear here when an operator records a bid from them, or approves one that Scout found on the web.</PageHeader>
      <p className="mt-4 text-xs text-muted-foreground">Mesh does not verify suppliers yet, so every supplier starts unverified. A web source is where Scout found it, not proof of anything.</p>
      {suppliers.length === 0 && <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No suppliers yet.</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {suppliers.map((supplier) => (
          <div key={supplier.id} className="glass-panel rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="truncate font-medium">{supplier.name}</h2><p className="text-[11px] text-muted-foreground">{supplier.region ?? "Region not recorded"}</p></div>
              <Badge variant="outline" className="capitalize">{supplier.verificationStatus}</Badge>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-foreground/10 pt-3 text-xs">
              <span>{supplier.bidCount} {supplier.bidCount === 1 ? "bid" : "bids"} recorded</span>
              {supplier.sourceUrl && (
                <a href={supplier.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="flex min-w-0 items-center gap-1 text-primary hover:underline">
                  <IconExternalLink size={13} className="shrink-0" /><span className="truncate">Web source · {new URL(supplier.sourceUrl).hostname}</span>
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
