"use client"

import { useState } from "react"
import Link from "next/link"
import { IconCheck, IconExternalLink, IconX } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"
import { rfqRef, usd, type ApprovalView, type RfqDraft, type SupplierCandidate } from "@/lib/rfq"

export function ApprovalCard({ approval }: { approval: ApprovalView }) {
  const { updateApproval } = useMesh()
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
  const [error, setError] = useState("")

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
      {approval.kind === "create_rfq" ? <RfqDetails draft={approval.draft} /> : <SupplierDetails supplier={approval.supplier} />}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {approval.status === "pending" && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => decide("approve")}>
            <IconCheck size={15} /> {approval.kind === "create_rfq" ? (busy === "approve" ? "Creating…" : "Approve & create RFQ") : (busy === "approve" ? "Adding…" : "Approve & add supplier")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide("reject")}><IconX size={15} /> Reject</Button>
        </div>
      )}
      {approval.status === "approved" && approval.resultId && (approval.kind === "create_rfq"
        ? <Link href={`/orders/${approval.resultId}`} className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-4`}>Open {rfqRef(approval.resultId)}</Link>
        : <Link href="/suppliers" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-4`}>Open suppliers</Link>)}
    </div>
  )
}

function RfqDetails({ draft }: { draft: RfqDraft }) {
  return (
    <>
      <p className="mt-3 text-sm font-medium">{draft.resource}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div><dt className="text-muted-foreground">Quantity</dt><dd>{draft.quantity.toLocaleString()} {draft.unit}</dd></div>
        <div><dt className="text-muted-foreground">Max budget</dt><dd className="font-mono">{usd(Math.round(draft.maxBudget * 100))}</dd></div>
        <div><dt className="text-muted-foreground">Deadline</dt><dd>{draft.deadline}</dd></div>
        <div><dt className="text-muted-foreground">Destination</dt><dd>{draft.destination}</dd></div>
      </dl>
    </>
  )
}

/** A web-discovered supplier. The source link is the operator's way to check it; nothing about it is verified. */
function SupplierDetails({ supplier }: { supplier: SupplierCandidate }) {
  return (
    <>
      <p className="mt-3 text-sm font-medium">Add supplier: {supplier.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{supplier.region ?? "Region not stated"} · found by web search, not verified</p>
      <p className="mt-3 text-xs">{supplier.reason}</p>
      <a href={supplier.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline">
        <IconExternalLink size={13} className="shrink-0" /><span className="truncate">{supplier.sourceTitle}</span><span className="shrink-0 text-muted-foreground">· {new URL(supplier.sourceUrl).hostname}</span>
      </a>
    </>
  )
}
