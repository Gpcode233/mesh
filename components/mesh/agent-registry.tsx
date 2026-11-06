"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconMessageCircle } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AGENTS } from "@/lib/agents"
import { useMesh } from "@/components/mesh/mesh-provider"
import { PageHeader, SimulatedNote } from "@/components/mesh/parts"

export function AgentRegistry() {
  const { registry, revokeAgent, setSelectedAgent, isFrozen } = useMesh()
  const router = useRouter()
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Agent registry" title="Who can act," muted="and how far.">Each agent&apos;s mandate scope, allowed methods, spending cap and expiry. Chat with any of them directly.</PageHeader>
      <SimulatedNote>Mandates are illustrative. Agents are prompt-routed personas, not durable workers, and revoking here does not yet revoke an on-chain key.</SimulatedNote>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {registry.map((entry) => {
          const profile = AGENTS[entry.id]
          const revoked = entry.expires === "revoked"
          return (
            <div key={entry.id} className="glass-panel rounded-2xl p-5">
              <div className="flex items-start justify-between">
                <div><h2 className="font-medium">{profile.label}</h2><p className="text-[11px] text-muted-foreground">{profile.detail}</p></div>
                <Badge variant={entry.online ? "default" : "outline"}>{revoked ? "Revoked" : entry.online ? "Online" : isFrozen ? "Frozen" : "Offline"}</Badge>
              </div>
              <p className="mt-4 text-sm">{entry.mandate}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{entry.methods.map((method) => <span key={method} className="rounded-md bg-accent/60 px-2 py-0.5 font-mono text-[10px]">{method}</span>)}</div>
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-foreground/10 pt-4 text-xs">
                <div><dt className="eyebrow">Cap</dt><dd className="mt-1 font-mono">{entry.cap ? `$${entry.cap.toLocaleString()}` : "none"}</dd></div>
                <div><dt className="eyebrow">Spend</dt><dd className="mt-1 font-mono">${entry.spend.toLocaleString()}</dd></div>
                <div><dt className="eyebrow">Expires</dt><dd className="mt-1 font-mono">{entry.expires}</dd></div>
              </dl>
              <p className="mt-3 text-[11px] text-muted-foreground">Last action: {entry.lastAction}</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setSelectedAgent(entry.id); router.push("/") }}><IconMessageCircle size={15} /> Chat</Button>
                <Button size="sm" variant="destructive" disabled={revoked} onClick={() => revokeAgent(entry.id)}>{revoked ? "Revoked" : "Revoke"}</Button>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">Prefer a single thread? <Link href="/" className="text-primary underline-offset-4 hover:underline">Open the group chat</Link> and message every agent at once.</p>
    </div>
  )
}
