import type { ReactNode } from "react"

export function PageHeader({ eyebrow, title, muted, children }: { eyebrow: string; title: string; muted?: string; children?: ReactNode }) {
  return (
    <div className="editorial-reveal border-b border-foreground/10 pb-8">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] md:text-6xl">
        {title}
        {muted && <><br /><span className="text-muted-foreground">{muted}</span></>}
      </h1>
      {children && <p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground">{children}</p>}
    </div>
  )
}

export function SimulatedNote({ children }: { children?: ReactNode }) {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-foreground/15 bg-card/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
      {children ?? "Simulated data — not connected to a database, chain, or live supplier network yet."}
    </p>
  )
}

export function Metric({ label, value, detail, icon, alert = false }: { label: string; value: string; detail: string; icon: ReactNode; alert?: boolean }) {
  return <div className="border-r border-foreground/10 px-0 py-6 first:pr-5 md:px-5 md:first:pl-0"><div className="flex items-center justify-between text-muted-foreground"><span className="eyebrow">{label}</span><span className={alert ? "text-destructive" : "text-primary"}>{icon}</span></div><div className="mt-4 text-3xl font-semibold tracking-[-0.06em]">{value}</div><p className={`mt-1 text-[11px] ${alert ? "text-destructive" : "text-muted-foreground"}`}>{detail}</p></div>
}

export function EconomyMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="border-l border-foreground/10 pl-4 first:border-0 first:pl-0"><p className="eyebrow">{label}</p><p className="mt-3 text-2xl font-semibold tracking-[-0.05em]">{value}</p><p className="mt-1 text-xs text-primary">{detail}</p></div>
}

export function SettlementRow({ label, detail, share }: { label: string; detail: string; share: string }) {
  return <div><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full bg-primary" />{label}<span className="text-xs text-muted-foreground">{detail}</span></span><span className="font-mono text-xs text-muted-foreground">{share}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: share }} /></div></div>
}

export function StatusRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs"><span className="text-[#93a39d]">{label}</span><span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#9bdba5]" />{value}</span></div>
}

export function Field({ label, name, placeholder, type = "text" }: { label: string; name: string; placeholder: string; type?: string }) {
  return <label className="grid gap-2 text-xs font-medium text-muted-foreground">{label}<input required name={name} type={type} placeholder={placeholder} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-normal text-foreground outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2" /></label>
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(timestamp)
}
