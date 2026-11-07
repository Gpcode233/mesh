"use client"

import { useState } from "react"
import Link from "next/link"
import { IconCheck, IconX } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { rfqRef, usd, type ApprovalView } from "@/lib/rfq"

export function ApprovalCard({ approval }: { approval: ApprovalView }) {
  const { updateApproval } = useMesh()
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
  const [error, setError] = useState("")
  const { draft } = approval

  async function decide(decision: "approve" | "reject") {
    setBusy(decision)
    setError("")
    try {
      const response = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      })
      const result = (await response.json().catch(() => ({}))) as { approval?: ApprovalView; error?: string }
      if (!response.ok || !result.approval) throw new Error(result.error ?? "The decision could not be saved.")
      updateApproval(result.approval)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be saved.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="approval-card" className="mt-3 rounded-xl border border-foreground/15 bg-card p-4 text-foreground">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Approval required</p>
        {approval.status !== "pending" && <Badge variant={approval.status === "approved" ? "default" : "outline"} className="capitalize">{approval.status}</Badge>}
      </div>
      <p className="mt-3 text-sm font-medium">{draft.resource}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div><dt className="text-muted-foreground">Quantity</dt><dd>{draft.quantity.toLocaleString()} {draft.unit}</dd></div>
        <div><dt className="text-muted-foreground">Max budget</dt><dd className="font-mono">{usd(Math.round(draft.maxBudget * 100))}</dd></div>
        <div><dt className="text-muted-foreground">Deadline</dt><dd>{draft.deadline}</dd></div>
        <div><dt className="text-muted-foreground">Destination</dt><dd>{draft.destination}</dd></div>
      </dl>
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {approval.status === "pending" && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => decide("approve")}><IconCheck size={15} /> {busy === "approve" ? "Creating…" : "Approve & create RFQ"}</Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide("reject")}><IconX size={15} /> Reject</Button>
        </div>
      )}
      {approval.status === "approved" && approval.resultId && (
        <Link href={`/orders/${approval.resultId}`} className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-4`}>Open {rfqRef(approval.resultId)}</Link>
      )}
    </div>
  )
}
