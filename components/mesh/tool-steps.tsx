"use client"

import { useState } from "react"
import { IconAlertTriangle, IconCheck, IconChevronRight, IconLoader2 } from "@tabler/icons-react"
import { TOOL_LABEL, type ToolStep } from "@/lib/chat-events"

/** What the agent actually ran for a reply. Open while anything is running or failed. */
export function ToolSteps({ steps }: { steps: ToolStep[] }) {
  const busy = steps.some((step) => step.status !== "done")
  const [open, setOpen] = useState<boolean | null>(null)
  if (steps.length === 0) return null
  const expanded = open ?? busy
  const done = steps.filter((step) => step.status === "done").length

  return (
    <div data-testid="tool-steps" className="mb-2 rounded-xl border border-foreground/10 bg-card/70 text-xs">
      <button type="button" onClick={() => setOpen(!expanded)} aria-expanded={expanded} className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground">
        <IconChevronRight size={13} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        <span className="font-medium">Tool calls</span>
        <span className="ml-auto tabular-nums">{done}/{steps.length}</span>
      </button>
      {expanded && (
        <ol className="grid gap-1.5 border-t border-foreground/10 px-3 py-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                {step.status === "running" && <IconLoader2 size={13} className="animate-spin text-primary" />}
                {step.status === "done" && <IconCheck size={13} className="text-primary" />}
                {step.status === "error" && <IconAlertTriangle size={13} className="text-destructive" />}
              </span>
              <span className="min-w-0">
                <span className={step.status === "error" ? "text-destructive" : "text-foreground"}>{TOOL_LABEL[step.tool]}</span>
                {step.detail && <span className="block text-muted-foreground">{step.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
