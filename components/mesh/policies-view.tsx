"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { PageHeader, SimulatedNote } from "@/components/mesh/parts"
import type { PolicyView } from "@/lib/rfq"

const list = (value: FormDataEntryValue | null) => String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)

export function PoliciesView({ policy, canEdit }: { policy: PolicyView; canEdit: boolean }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    setSaved(false)
    try {
      const response = await fetch("/api/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailySpendLimit: Number(data.get("dailySpendLimit")),
          perOrderLimit: Number(data.get("perOrderLimit")),
          approvalThreshold: Number(data.get("approvalThreshold")),
          requiredBidCount: Number(data.get("requiredBidCount")),
          approvedRegions: list(data.get("approvedRegions")),
          requiredDocuments: list(data.get("requiredDocuments")),
          approvedAssets: list(data.get("approvedAssets")),
          approvedChains: list(data.get("approvedChains")),
          agentKeyExpiryHours: Number(data.get("agentKeyExpiryHours")),
          freezeBehavior: data.get("freezeBehavior"),
        }),
      })
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(result.error ?? "Policy could not be saved.")
      }
      setSaved(true)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Policy could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, name: keyof PolicyView, type: "number" | "text" = "text") => {
    const value = policy[name]
    return (
      <label className="grid gap-2 text-xs font-medium text-muted-foreground">{label}
        <input required={type === "number" || name === "freezeBehavior"} disabled={!canEdit} type={type} name={name} defaultValue={Array.isArray(value) ? value.join(", ") : value} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-normal text-foreground outline-none ring-primary/40 focus:ring-2 disabled:opacity-60" />
      </label>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Policy center" title="Set the rules" muted="agents can't break.">Limits are checked on the server every time a supplier is selected.</PageHeader>
      <SimulatedNote>Enforced today: daily limit, per-order limit, approval threshold, required bids. Saved but not enforced yet: regions, documents, assets, chains, key expiration, freeze behavior. Nothing is enforced on-chain.</SimulatedNote>
      <form onSubmit={save} className="glass-panel mt-6 grid gap-5 rounded-2xl p-6 md:grid-cols-2">
        {field("Daily company spend limit (USD)", "dailySpendLimit", "number")}
        {field("Per-order limit (USD)", "perOrderLimit", "number")}
        {field("Owner approval threshold (USD)", "approvalThreshold", "number")}
        {field("Required bid count", "requiredBidCount", "number")}
        {field("Approved supplier regions", "approvedRegions")}
        {field("Required compliance documents", "requiredDocuments")}
        {field("Approved assets", "approvedAssets")}
        {field("Approved chains", "approvedChains")}
        {field("Agent key expiration (hours)", "agentKeyExpiryHours", "number")}
        {field("Emergency freeze behavior", "freezeBehavior")}
        <div className="flex items-center gap-3 md:col-span-2">
          {canEdit ? <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save policy"}</Button> : <p className="text-xs text-muted-foreground">Only an owner can change policy.</p>}
          {saved && <p role="status" className="text-xs text-primary">Policy saved.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </form>
    </div>
  )
}
