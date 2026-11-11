"use client"

import { IconBolt, IconUsers } from "@tabler/icons-react"
import { AGENT_LIST, type AgentId } from "@/lib/agents"
import { useMesh, type ChatMessage, type GroupMessage } from "@/components/mesh/mesh-provider"

export type ChatView = { kind: "direct"; agent: AgentId } | { kind: "group" }

/**
 * Previews show the operator's last message, not the agent's reply: the reply is already on screen in the
 * open thread, and showing it twice would make the page ambiguous to read and to test.
 */
function preview(messages: Array<ChatMessage | GroupMessage>) {
  const last = [...messages].reverse().find((message) => message.role === "user")
  return last ? `You: ${last.text}` : null
}

export function ChatThreadList({ view, onSelect }: { view: ChatView; onSelect: (view: ChatView) => void }) {
  const { threads, pending, group, groupBusy } = useMesh()

  return (
    <nav aria-label="Conversations" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {AGENT_LIST.map((agent) => {
          const active = view.kind === "direct" && view.agent === agent.id
          const messages = threads[agent.id]
          const count = messages.filter((message) => message.role === "user").length
          const failed = messages.at(-1)?.error
          return (
            <ThreadButton
              key={agent.id}
              active={active}
              onClick={() => onSelect({ kind: "direct", agent: agent.id })}
              icon={<IconBolt size={14} />}
              label={agent.label}
              detail={agent.detail}
              preview={preview(messages)}
              status={pending[agent.id] ? "busy" : failed ? "error" : null}
              count={count}
            />
          )
        })}
        <div className="mx-2 my-2 border-t border-foreground/10" />
        <ThreadButton
          active={view.kind === "group"}
          onClick={() => onSelect({ kind: "group" })}
          icon={<IconUsers size={14} />}
          label="Group — all agents"
          detail="One message, six answers"
          preview={preview(group)}
          status={groupBusy ? "busy" : null}
          count={group.filter((message) => message.role === "user").length}
        />
      </div>
    </nav>
  )
}

function ThreadButton(props: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  detail: string
  preview: string | null
  status: "busy" | "error" | null
  count: number
}) {
  const { active, status } = props
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${active ? "bg-foreground text-background" : "text-foreground hover:bg-accent/50"}`}
    >
      <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${active ? "bg-background/15 text-background" : "bg-accent text-primary"}`}>{props.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{props.label}</span>
          {status === "busy" && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#39a96b]"><span className="sr-only">working</span></span>}
          {status === "error" && <span className="size-1.5 shrink-0 rounded-full bg-destructive"><span className="sr-only">last reply failed</span></span>}
          {props.count > 0 && <span className={`ml-auto shrink-0 font-mono text-[10px] ${active ? "text-background/60" : "text-muted-foreground"}`}>{props.count}</span>}
        </span>
        <span className={`mt-0.5 block truncate text-[11px] ${active ? "text-background/65" : "text-muted-foreground"}`}>{props.preview ?? props.detail}</span>
      </span>
    </button>
  )
}
