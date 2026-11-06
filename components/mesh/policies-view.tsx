"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { PageHeader, SimulatedNote } from "@/components/mesh/parts"

const defaults = {
  dailyLimit: 50000,
  perOrderLimit: 20000,
  approvalThreshold: 10000,
  requiredBids: 3,
  regions: "EU, US, JP",
  documents: "ISO 9001, Sanctions screening",
  assets: "USDC, USDT",
  chains: "NEAR, Ethereum",
  keyExpiryHours: 24,
  freezeBehavior: "Revoke all keys",
}

export function PoliciesView() {
  const { notify } = useMesh()
  const [policy, setPolicy] = useState(defaults)
  const set = (key: keyof typeof defaults, value: string) =>
    setPolicy((current) => ({ ...current, [key]: typeof defaults[key] === "number" ? Number(value) : value }))

  function save() {
    if (policy.approvalThreshold > policy.perOrderLimit || policy.perOrderLimit > policy.dailyLimit) {
      notify("Thresholds must satisfy approval ≤ per-order ≤ daily.")
      return
    }
    notify("Draft policy validated. Server/contract enforcement is not wired yet — not saved.")
  }

  const field = (label: string, key: keyof typeof defaults, type: "number" | "text" = "text") => (
    <label className="grid gap-2 text-xs font-medium text-muted-foreground">{label}
      <input type={type} value={policy[key]} onChange={(event) => set(key, event.target.value)} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-normal text-foreground outline-none ring-primary/40 focus:ring-2" />
    </label>
  )

  return (
    <div className="mx-auto max-w-[900px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Policy center" title="Set the rules" muted="agents can't break.">Spending limits, approvals, supplier requirements and key lifetimes.</PageHeader>
      <SimulatedNote>Draft only. Policies are not persisted and are not enforced server-side or on-chain yet.</SimulatedNote>
      <div className="glass-panel mt-6 grid gap-5 rounded-2xl p-6 md:grid-cols-2">
        {field("Daily company spend limit (USD)", "dailyLimit", "number")}
        {field("Per-order limit (USD)", "perOrderLimit", "number")}
        {field("Human approval threshold (USD)", "approvalThreshold", "number")}
        {field("Required bid count", "requiredBids", "number")}
        {field("Approved supplier regions", "regions")}
        {field("Required compliance documents", "documents")}
        {field("Approved assets", "assets")}
        {field("Approved chains", "chains")}
        {field("Agent key expiration (hours)", "keyExpiryHours", "number")}
        {field("Emergency freeze behavior", "freezeBehavior")}
        <div className="md:col-span-2"><Button onClick={save}>Validate draft</Button></div>
      </div>
    </div>
  )
}
