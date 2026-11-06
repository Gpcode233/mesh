"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { IconArrowUpRight, IconBolt, IconSparkles, IconUsers, IconUser } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AGENT_LIST, AGENTS } from "@/lib/agents"
import { AgentGroupChat } from "@/components/mesh/agent-group-chat"
import { useMesh } from "@/components/mesh/mesh-provider"
import { MessageText } from "@/components/mesh/message-text"
import { PageHeader, StatusRow } from "@/components/mesh/parts"

export function HeadAgent() {
  const [mode, setMode] = useState<"direct" | "group">("direct")
  const { historyError } = useMesh()
  return (
    <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1"><PageHeader eyebrow="Head agent / private workspace" title="Ask Mesh" muted="to move it.">Talk to the Head Agent, any specialist directly, or all of them at once.</PageHeader></div>
      </div>
      <div className="mt-6 inline-flex rounded-full border border-border bg-card/60 p-1 text-xs">
        <button onClick={() => setMode("direct")} className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 ${mode === "direct" ? "bg-foreground text-background" : "text-muted-foreground"}`}><IconUser size={14} /> Direct</button>
        <button onClick={() => setMode("group")} className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 ${mode === "group" ? "bg-foreground text-background" : "text-muted-foreground"}`}><IconUsers size={14} /> Group — all agents</button>
      </div>
      {historyError && <p role="alert" className="mt-4 text-sm text-destructive">{historyError}</p>}
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_280px]">
        {mode === "direct" ? <DirectChat /> : <AgentGroupChat />}
        <Sidebar />
      </div>
    </div>
  )
}

function DirectChat() {
  const { selectedAgent, setSelectedAgent, threads, pending, contexts, setAgentContext, sendToAgent, simulateIntent } = useMesh()
  const [input, setInput] = useState("")
  const endRef = useRef<HTMLDivElement>(null)
  const profile = AGENTS[selectedAgent]
  const messages = threads[selectedAgent]
  const busy = pending[selectedAgent]

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, busy, selectedAgent])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput("")
    void sendToAgent(selectedAgent, text)
  }

  return (
    <section className="glass-panel flex min-h-[600px] flex-col rounded-2xl p-5">
      <div className="flex gap-1.5 overflow-x-auto border-b border-foreground/10 pb-3">
        {AGENT_LIST.map((agent) => (
          <button key={agent.id} onClick={() => setSelectedAgent(agent.id)} className={`relative shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${selectedAgent === agent.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}>
            {agent.label}
            {pending[agent.id] && <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-[#39a96b]" />}
            {agent.id !== selectedAgent && threads[agent.id].length > (agent.id === "head" ? 1 : 0) && <span className="ml-1.5 text-[9px] opacity-60">{threads[agent.id].length}</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-foreground text-background"><IconBolt size={17} /></span><div><p className="text-sm font-medium">Mesh / {profile.label}</p><p className="text-[11px] text-muted-foreground">{profile.detail} · prompt-routed persona, no tools</p></div></div>
        <Badge variant="outline">PRIVATE</Badge>
      </div>
      <div className="min-h-[280px] flex-1 space-y-5 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            No messages with {profile.label} yet. Try:
            <div className="mt-3 flex flex-wrap gap-2">{profile.starters.map((starter) => <button key={starter} onClick={() => void sendToAgent(selectedAgent, starter)} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] hover:border-primary hover:text-primary">{starter}</button>)}</div>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : ""}`}>
            <div className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "rounded-br-md bg-foreground text-background" : message.error ? "rounded-bl-md border border-destructive/30 bg-destructive/10 text-destructive" : "rounded-bl-md bg-accent/55 text-foreground"}`}>
              <div className={`mb-1 text-[10px] uppercase tracking-[0.12em] ${message.role === "user" ? "text-background/60" : message.error ? "text-destructive" : "text-primary"}`}>{message.role === "user" ? "You" : message.error ? "Provider error" : profile.label}</div>
              {message.role === "assistant" && !message.error ? <MessageText text={message.text} /> : message.text}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted-foreground">{profile.label} is thinking…</div>}
        <div ref={endRef} />
      </div>
      {messages.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {profile.starters.slice(0, 2).map((starter) => <button key={starter} disabled={busy} onClick={() => void sendToAgent(selectedAgent, starter)} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50">{starter}</button>)}
          <button onClick={simulateIntent} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary">Simulate a settlement</button>
        </div>
      )}
      <div className="mb-3 grid gap-2 rounded-xl border border-border bg-card/60 p-3">
        <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" htmlFor="agent-context">Context for {profile.label}</label>
        <textarea id="agent-context" value={contexts[selectedAgent]} onChange={(event) => setAgentContext(selectedAgent, event.target.value)} placeholder="Add supplier preferences, constraints, or evidence…" rows={2} className="resize-none bg-transparent text-xs leading-5 outline-none placeholder:text-muted-foreground/65" />
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-border bg-card/70 p-2 focus-within:border-primary">
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`Message ${profile.label}…`} className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/65" />
        <Button size="sm" type="submit" disabled={busy || !input.trim()}><IconArrowUpRight size={16} /> {busy ? "Thinking" : "Send"}</Button>
      </form>
    </section>
  )
}

function Sidebar() {
  const { registry } = useMesh()
  const online = registry.filter((agent) => agent.online).length
  return (
    <aside className="space-y-4">
      <div className="rounded-2xl bg-[#141b1d] p-5 text-[#ecf3ec]">
        <p className="eyebrow text-[#93a39d]">Agent posture</p>
        <h2 className="mt-3 text-xl font-medium">Bounded autonomy</h2>
        <p className="mt-3 text-xs leading-5 text-[#93a39d]">Agents only advise and draft here: they have no tools yet, so nothing they say has been executed or checked.</p>
        <div className="mt-6 space-y-3 text-xs"><StatusRow label="Simulated mandates" value={`${online} / ${registry.length} active`} /><StatusRow label="Tool access" value="None" /><StatusRow label="Conversations" value="Saved" /></div>
      </div>
      <div className="glass-panel rounded-2xl p-5">
        <p className="eyebrow">Suggested next moves</p>
        <div className="mt-4 grid gap-3 text-sm">
          {["Compare the 3 lithium bids", "Explain today's spend velocity", "Audit the latest settlement"].map((item) => <div key={item} className="flex gap-3"><IconSparkles size={16} className="mt-0.5 shrink-0 text-primary" /><span>{item}</span></div>)}
        </div>
      </div>
    </aside>
  )
}

