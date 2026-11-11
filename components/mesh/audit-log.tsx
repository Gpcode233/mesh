"use client"

import { useEffect, useState } from "react"
import { IconActivity, IconAlertTriangle, IconCheck } from "@tabler/icons-react"
import { useMesh } from "@/components/mesh/mesh-provider"
import { formatTime, PageHeader, SimulatedNote } from "@/components/mesh/parts"

type RecordedEvent = { id: number; action: string; target: string | null; actor: string | null; createdAt: number }

export function AuditLog() {
  const { events } = useMesh()
  const [recorded, setRecorded] = useState<RecordedEvent[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/audit")
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setRecorded(((await response.json()) as { events: RecordedEvent[] }).events)
      })
      .catch(() => setError("Recorded events could not be loaded."))
  }, [])

  return (
    <div className="mx-auto max-w-[900px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <PageHeader eyebrow="Audit log" title="Everything" muted="on the record.">Sign-ins, agent chats, agent tool calls, approvals, RFQs, bids, supplier selections and policy changes are recorded in the database, without message content. Newest first.</PageHeader>
      <h2 className="mt-8 text-lg font-semibold tracking-tight">Recorded events</h2>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {!error && recorded === null && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {recorded?.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No events yet.</p>}
      {recorded && recorded.length > 0 && (
        <div data-testid="recorded-events" className="mt-3 overflow-hidden rounded-2xl border border-foreground/10 bg-card/55">
          {recorded.map((event) => (
            <div key={event.id} className="flex items-baseline justify-between gap-4 border-b border-foreground/8 px-5 py-3 last:border-0">
              <span className="min-w-0 truncate font-mono text-xs">{event.action}{event.target ? ` · ${event.target}` : ""}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatTime(event.createdAt)} · {event.actor ?? "unknown"}</span>
            </div>
          ))}
        </div>
      )}
      <h2 className="mt-10 text-lg font-semibold tracking-tight">Simulated session events</h2>
      <SimulatedNote>In-memory only: a refresh clears these. They are browser-side demo telemetry, not recorded actions.</SimulatedNote>
      <div className="mt-4 overflow-hidden rounded-2xl border border-foreground/10 bg-card/55">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3 border-b border-foreground/8 px-5 py-4 last:border-0">
            <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${event.level === "error" ? "bg-destructive/10 text-destructive" : "bg-accent text-primary"}`}>{event.level === "error" ? <IconAlertTriangle size={13} /> : event.level === "success" ? <IconCheck size={13} /> : <IconActivity size={13} />}</span>
            <div className="min-w-0"><p className="text-sm">{event.message}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{formatTime(event.timestamp)} · {event.metadata ?? "—"}</p></div>
          </div>
        ))}
      </div>
    </div>
  )
}
