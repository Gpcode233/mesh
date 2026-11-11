"use client"

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { IconArrowUpRight, IconNotes } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

const MAX_ROWS_PX = 200

/** Bottom-pinned input. Enter sends, Shift+Enter adds a line. Optional per-agent context drawer. */
export function ChatComposer(props: {
  placeholder: string
  busy: boolean
  sendLabel: string
  busyLabel: string
  onSend: (text: string) => void
  context?: { label: string; value: string; onChange: (value: string) => void }
}) {
  const [input, setInput] = useState("")
  const [contextOpen, setContextOpen] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)

  // Grow with content up to a cap, then scroll inside the box.
  useEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, MAX_ROWS_PX)}px`
  }, [input])

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const text = input.trim()
    if (!text || props.busy) return
    setInput("")
    props.onSend(text)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
  }

  const { context } = props
  return (
    <div className="shrink-0 border-t border-foreground/10 p-3">
      {context && contextOpen && (
        <div className="mb-2 grid gap-1.5 rounded-xl border border-border bg-card/60 p-3">
          <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" htmlFor="agent-context">{context.label}</label>
          <textarea
            id="agent-context"
            value={context.value}
            onChange={(event) => context.onChange(event.target.value)}
            placeholder="Supplier preferences, constraints or evidence. Sent with every message as data, not instructions."
            rows={2}
            className="resize-none bg-transparent text-xs leading-5 outline-none placeholder:text-muted-foreground/65"
          />
        </div>
      )}
      <form onSubmit={submit} className="rounded-2xl border border-border bg-card/70 transition-colors focus-within:border-primary">
        <textarea
          ref={textarea}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.placeholder}
          rows={1}
          className="block max-h-[200px] min-h-11 w-full resize-none bg-transparent px-4 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/65"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          {context ? (
            <button
              type="button"
              onClick={() => setContextOpen((open) => !open)}
              aria-expanded={contextOpen}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors hover:bg-accent/50 ${context.value.trim() ? "text-primary" : "text-muted-foreground"}`}
            >
              <IconNotes size={14} /> Context{context.value.trim() ? " · set" : ""}
            </button>
          ) : <span />}
          <span className="flex items-center gap-2">
            <span className="hidden text-[10px] text-muted-foreground sm:inline">Enter to send · Shift+Enter for a new line</span>
            <Button size="sm" type="submit" disabled={props.busy || !input.trim()}><IconArrowUpRight size={16} /> {props.busy ? props.busyLabel : props.sendLabel}</Button>
          </span>
        </div>
      </form>
    </div>
  )
}
