"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { IconArrowUpRight } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AGENT_LIST, AGENTS } from "@/lib/agents"
import { MessageText } from "@/components/mesh/message-text"
import { useMesh } from "@/components/mesh/mesh-provider"

export function AgentGroupChat() {
  const { group, groupBusy, sendToGroup } = useMesh()
  const [input, setInput] = useState("")
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [group])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = input.trim()
    if (!text || groupBusy) return
    setInput("")
    void sendToGroup(text)
  }

  return (
    <section className="glass-panel flex min-h-[600px] flex-col rounded-2xl p-5">
      <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
        <div>
          <p className="text-sm font-medium">Mesh / Group channel</p>
          <p className="text-[11px] text-muted-foreground">{AGENT_LIST.map((agent) => agent.label).join(" · ")}</p>
        </div>
        <Badge variant="outline">ALL AGENTS</Badge>
      </div>
      <div className="min-h-[300px] flex-1 space-y-4 overflow-y-auto py-5">
        {group.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            Every message goes to all six agents. Each answers from its own role and sees what the others said earlier.
            <div className="mt-3 flex flex-wrap gap-2">
              {["We need 500kg of lithium carbonate by Nov 20 — what should each of you check first?", "Assess the risk of paying a new supplier 50% upfront"].map((starter) => (
                <button key={starter} onClick={() => void sendToGroup(starter)} className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-[11px] hover:border-primary hover:text-primary">{starter}</button>
              ))}
            </div>
          </div>
        )}
        {group.map((message) => message.role === "user" ? (
          <div key={message.id} className="flex justify-end"><div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-6 text-background"><div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-background/60">You → everyone</div>{message.text}</div></div>
        ) : (
          <div key={message.id} className="flex"><div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-6 ${message.error ? "border border-destructive/30 bg-destructive/10 text-destructive" : "bg-accent/55"}`}>
            <div className={`mb-1 text-[10px] uppercase tracking-[0.12em] ${message.error ? "text-destructive" : "text-primary"}`}>{AGENTS[message.agent!].label}{message.error ? " · error" : ""}</div>
            {message.pending ? <span className="animate-pulse text-muted-foreground">thinking…</span> : message.error ? message.text : <MessageText text={message.text} />}
          </div></div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-border bg-card/70 p-2 focus-within:border-primary">
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Message all agents…" className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/65" />
        <Button size="sm" type="submit" disabled={groupBusy || !input.trim()}><IconArrowUpRight size={16} /> {groupBusy ? "Waiting" : "Send to all"}</Button>
      </form>
    </section>
  )
}
