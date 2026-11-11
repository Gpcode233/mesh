"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { IconAlertTriangle, IconArrowDown, IconBolt, IconCopy, IconDownload, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMenu2, IconRefresh, IconUsers, IconX } from "@tabler/icons-react"
import { AGENT_LIST, AGENTS, type AgentId } from "@/lib/agents"
import { ApprovalCard } from "@/components/mesh/approval-card"
import { ChatComposer } from "@/components/mesh/chat-composer"
import { ChatThreadList, type ChatView } from "@/components/mesh/chat-thread-list"
import { GROUP_STARTERS, GroupMessages } from "@/components/mesh/agent-group-chat"
import { useMesh, type ChatMessage, type GroupMessage } from "@/components/mesh/mesh-provider"
import { MessageText } from "@/components/mesh/message-text"
import { ToolSteps } from "@/components/mesh/tool-steps"

/** The default route: a conversation column, then the open thread with a pinned composer. */
export function HeadAgent() {
  const { selectedAgent, setSelectedAgent, threads, pending, group, groupBusy, contexts, setAgentContext, sendToAgent, sendToGroup, historyError } = useMesh()
  const [mode, setMode] = useState<"direct" | "group">("direct")
  const [listOpen, setListOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const view: ChatView = mode === "group" ? { kind: "group" } : { kind: "direct", agent: selectedAgent }

  function select(next: ChatView) {
    if (next.kind === "group") setMode("group")
    else {
      setMode("direct")
      setSelectedAgent(next.agent)
    }
    setDrawerOpen(false)
  }

  const profile = AGENTS[selectedAgent]
  const directMessages = threads[selectedAgent]
  const isGroup = view.kind === "group"
  const busy = isGroup ? groupBusy : pending[selectedAgent]
  const status = isGroup ? groupStatus(group, groupBusy) : directStatus(directMessages, busy)
  const transcript = isGroup ? groupTranscript(group) : directTranscript(directMessages, profile.label)
  const title = isGroup ? "Group — all agents" : profile.label

  return (
    <div className="glass-panel editorial-reveal flex h-full min-h-0 overflow-hidden rounded-2xl">
      {listOpen && (
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-r border-foreground/10 lg:flex">
          <ListHeader />
          <ChatThreadList view={view} onSelect={select} />
          <ListFooter />
        </aside>
      )}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex bg-foreground/30 backdrop-blur-sm lg:hidden" onClick={() => setDrawerOpen(false)}>
          <aside className="flex h-full w-72 max-w-[85vw] flex-col bg-background shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <ListHeader onClose={() => setDrawerOpen(false)} />
            <ChatThreadList view={view} onSelect={select} />
            <ListFooter />
          </aside>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-foreground/10 px-4 py-3">
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Conversations" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground lg:hidden"><IconMenu2 size={18} /></button>
          <button type="button" onClick={() => setListOpen((open) => !open)} aria-label={listOpen ? "Hide conversations" : "Show conversations"} className="hidden rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground lg:block">
            {listOpen ? <IconLayoutSidebarLeftCollapse size={18} /> : <IconLayoutSidebarLeftExpand size={18} />}
          </button>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background">{isGroup ? <IconUsers size={17} /> : <IconBolt size={17} />}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Mesh / {title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {isGroup ? `${AGENT_LIST.map((agent) => agent.label).join(" · ")} · no tools` : `${profile.detail} · reads Mesh records${selectedAgent === "head" ? ", can draft RFQs" : ""}`}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <StatusPill status={status} />
            <IconAction label="Copy conversation" disabled={!transcript} onClick={() => void navigator.clipboard.writeText(transcript)}><IconCopy size={16} /></IconAction>
            <IconAction label="Export as Markdown" disabled={!transcript} onClick={() => download(`mesh-${isGroup ? "group" : selectedAgent}.md`, `# Mesh / ${title}\n\n${transcript}\n`)}><IconDownload size={16} /></IconAction>
          </div>
        </header>

        {historyError && <Banner title="History unavailable" message={historyError} />}
        {isGroup ? <GroupErrorBanner messages={group} /> : <DirectErrorBanner key={`banner-${selectedAgent}`} agent={selectedAgent} messages={directMessages} busy={busy} onRetry={(text) => void sendToAgent(selectedAgent, text)} />}

        <ScrollPane key={`pane-${isGroup ? "group" : selectedAgent}`} follow={isGroup ? group : directMessages}>
          {isGroup ? (
            group.length === 0
              ? <EmptyState text="Every message goes to all six agents. Each answers from its own role and sees what the others said earlier." starters={GROUP_STARTERS} onPick={(text) => void sendToGroup(text)} />
              : <GroupMessages messages={group} />
          ) : (
            <>
              {directMessages.length === 0 && <EmptyState text={`No messages with ${profile.label} yet. Try:`} starters={profile.starters} onPick={(text) => void sendToAgent(selectedAgent, text)} />}
              {directMessages.map((message) => <DirectMessage key={message.id} message={message} label={profile.label} />)}
              {directMessages.length > 0 && directMessages.length < 3 && !busy && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {profile.starters.map((starter) => <StarterChip key={starter} text={starter} onPick={(text) => void sendToAgent(selectedAgent, text)} />)}
                </div>
              )}
            </>
          )}
        </ScrollPane>

        {isGroup
          ? <ChatComposer key="composer-group" placeholder="Message all agents…" busy={groupBusy} sendLabel="Send to all" busyLabel="Waiting" onSend={(text) => void sendToGroup(text)} />
          : <ChatComposer key={`composer-${selectedAgent}`} placeholder={`Message ${profile.label}…`} busy={busy} sendLabel="Send" busyLabel="Thinking" onSend={(text) => void sendToAgent(selectedAgent, text)} context={{ label: `Context for ${profile.label}`, value: contexts[selectedAgent], onChange: (value) => setAgentContext(selectedAgent, value) }} />}
      </section>
    </div>
  )
}

function ListHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-2 border-b border-foreground/10 px-4 py-4">
      <div>
        <p className="eyebrow">Mesh / workspace</p>
        <h1 className="mt-1.5 text-xl font-semibold tracking-[-0.04em]">Ask Mesh</h1>
      </div>
      {onClose && <button type="button" onClick={onClose} aria-label="Close conversations" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50"><IconX size={16} /></button>}
    </div>
  )
}

function ListFooter() {
  return (
    <p className="shrink-0 border-t border-foreground/10 px-4 py-3 text-[11px] leading-5 text-muted-foreground">
      Agents read your records and advise. Only the Head Agent can draft an RFQ, and it exists only once you approve it.
    </p>
  )
}

type Status = { tone: "ready" | "busy" | "error"; label: string }

function directStatus(messages: ChatMessage[], busy: boolean): Status {
  const last = messages.at(-1)
  if (busy) {
    if (last?.steps?.some((step) => step.status === "running")) return { tone: "busy", label: "Reading records…" }
    return { tone: "busy", label: last?.text ? "Replying…" : "Thinking…" }
  }
  if (last?.error) return { tone: "error", label: "Last reply failed" }
  return { tone: "ready", label: "Ready" }
}

function groupStatus(messages: GroupMessage[], busy: boolean): Status {
  if (busy) {
    const waiting = messages.filter((message) => message.pending).length
    return { tone: "busy", label: `${waiting} of ${AGENT_LIST.length} answering…` }
  }
  return latestGroupFailures(messages).length ? { tone: "error", label: "Some replies failed" } : { tone: "ready", label: "Ready" }
}

function StatusPill({ status }: { status: Status }) {
  const tone = {
    ready: "bg-[#39a96b]/10 text-[#24774a]",
    busy: "bg-amber-500/10 text-amber-700",
    error: "bg-destructive/10 text-destructive",
  }[status.tone]
  const dot = { ready: "bg-[#39a96b]", busy: "animate-pulse bg-amber-500", error: "bg-destructive" }[status.tone]
  return (
    <span role="status" className={`mr-1 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:flex ${tone}`}>
      <span className={`size-1.5 rounded-full ${dot}`} />{status.label}
    </span>
  )
}

function IconAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-30">{children}</button>
}

function Banner({ title, message, actions, onDismiss }: { title: string; message: string; actions?: ReactNode; onDismiss?: () => void }) {
  return (
    <div role="alert" className="flex shrink-0 items-start gap-2.5 border-b border-destructive/20 bg-destructive/5 px-4 py-2.5">
      <IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-destructive">{title}</p>
        <p className="break-words font-mono text-[11px] text-destructive/80">{message}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <button type="button" onClick={() => void navigator.clipboard.writeText(message)} className="rounded-md px-2 py-1 text-[11px] text-destructive/80 hover:bg-destructive/10">Copy</button>
        {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-md p-1 text-destructive/70 hover:bg-destructive/10"><IconX size={13} /></button>}
      </div>
    </div>
  )
}

function DirectErrorBanner({ agent, messages, busy, onRetry }: { agent: AgentId; messages: ChatMessage[]; busy: boolean; onRetry: (text: string) => void }) {
  const [dismissed, setDismissed] = useState<string | null>(null)
  const last = messages.at(-1)
  if (!last?.error || last.id === dismissed) return null
  const lastUser = [...messages].reverse().find((message) => message.role === "user")
  return (
    <Banner
      title={`${AGENTS[agent].label} could not reply`}
      message={last.text}
      onDismiss={() => setDismissed(last.id)}
      actions={lastUser && <button type="button" disabled={busy} onClick={() => onRetry(lastUser.text)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40"><IconRefresh size={12} /> Retry</button>}
    />
  )
}

/** Failed replies to the most recent group message. */
function latestGroupFailures(messages: GroupMessage[]) {
  const start = messages.findLastIndex((message) => message.role === "user")
  return start < 0 ? [] : messages.slice(start + 1).filter((message) => message.error)
}

function GroupErrorBanner({ messages }: { messages: GroupMessage[] }) {
  const [dismissed, setDismissed] = useState<string | null>(null)
  const failures = latestGroupFailures(messages)
  const key = failures.map((message) => message.id).join(",")
  if (!failures.length || key === dismissed) return null
  return (
    <Banner
      title={`${failures.length} of ${AGENT_LIST.length} agents could not reply`}
      message={failures.map((message) => `${AGENTS[message.agent!].label}: ${message.text}`).join("\n")}
      onDismiss={() => setDismissed(key)}
    />
  )
}

/**
 * Scrolls to the newest message while the reader is at the bottom. If they scroll up to read, it stays
 * put and offers a jump button instead of yanking them down on every streamed token.
 */
/** Keyed by thread, so switching threads starts pinned to the bottom again. */
function ScrollPane({ follow, children }: { follow: unknown; children: ReactNode }) {
  const pane = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const toBottom = (behavior: ScrollBehavior = "auto") => {
    const element = pane.current
    if (element) element.scrollTo({ top: element.scrollHeight, behavior })
  }

  useLayoutEffect(() => toBottom(), [])

  useEffect(() => {
    if (pinned.current) toBottom()
  }, [follow])

  function onScroll() {
    const element = pane.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    pinned.current = atBottom
    setShowJump(!atBottom)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={pane} onScroll={onScroll} className="h-full space-y-5 overflow-y-auto overscroll-contain px-4 py-5">
        {children}
      </div>
      {showJump && (
        <button type="button" onClick={() => toBottom("smooth")} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium shadow-md hover:border-primary">
          <IconArrowDown size={13} /> Jump to latest
        </button>
      )}
    </div>
  )
}

function DirectMessage({ message, label }: { message: ChatMessage; label: string }) {
  const mine = message.role === "user"
  return (
    <div className={`flex ${mine ? "justify-end" : ""}`}>
      <div className={`max-w-[82%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl px-4 py-3 text-sm leading-6 ${mine ? "rounded-br-md bg-foreground text-background" : message.error ? "rounded-bl-md border border-destructive/30 bg-destructive/10 text-destructive" : "rounded-bl-md bg-accent/55 text-foreground"}`}>
        <div className={`mb-1 text-[10px] uppercase tracking-[0.12em] ${mine ? "text-background/60" : message.error ? "text-destructive" : "text-primary"}`}>{mine ? "You" : message.error ? "Provider error" : label}</div>
        {message.steps && message.steps.length > 0 && <ToolSteps steps={message.steps} />}
        {!mine && !message.error
          ? (message.streaming && !message.text ? <span className="animate-pulse text-muted-foreground">{message.steps?.length ? "Reading records…" : "Thinking…"}</span> : <MessageText text={message.text} />)
          : message.text}
        {message.approval && <ApprovalCard approval={message.approval} />}
      </div>
    </div>
  )
}

function EmptyState({ text, starters, onPick }: { text: string; starters: string[]; onPick: (text: string) => void }) {
  return (
    <div className="mx-auto mt-6 max-w-md rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
      {text}
      <div className="mt-3 flex flex-wrap gap-2">{starters.map((starter) => <StarterChip key={starter} text={starter} onPick={onPick} />)}</div>
    </div>
  )
}

function StarterChip({ text, onPick }: { text: string; onPick: (text: string) => void }) {
  return <button type="button" onClick={() => onPick(text)} className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary">{text}</button>
}

function directTranscript(messages: ChatMessage[], label: string) {
  return messages
    .filter((message) => message.text && !message.streaming)
    .map((message) => `**${message.role === "user" ? "You" : message.error ? `${label} (error)` : label}:** ${message.text}`)
    .join("\n\n")
}

function groupTranscript(messages: GroupMessage[]) {
  return messages
    .filter((message) => message.text && !message.pending)
    .map((message) => `**${message.role === "user" ? "You" : `${AGENTS[message.agent!].label}${message.error ? " (error)" : ""}`}:** ${message.text}`)
    .join("\n\n")
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
