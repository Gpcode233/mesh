"use client"

import { AGENTS } from "@/lib/agents"
import { MessageText } from "@/components/mesh/message-text"
import type { GroupMessage } from "@/components/mesh/mesh-provider"

export const GROUP_STARTERS = [
  "We need 500kg of lithium carbonate by Nov 20 — what should each of you check first?",
  "Assess the risk of paying a new supplier 50% upfront",
]

/** The group channel's messages. The surrounding workspace provides the frame and the composer. */
export function GroupMessages({ messages }: { messages: GroupMessage[] }) {
  return (
    <>
      {messages.map((message) => message.role === "user" ? (
        <div key={message.id} className="flex justify-end">
          <div className="max-w-[82%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-6 text-background">
            <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-background/60">You → everyone</div>
            {message.text}
          </div>
        </div>
      ) : (
        <div key={message.id} className="flex">
          <div className={`max-w-[88%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl rounded-bl-md px-4 py-3 text-sm leading-6 ${message.error ? "border border-destructive/30 bg-destructive/10 text-destructive" : "bg-accent/55"}`}>
            <div className={`mb-1 text-[10px] uppercase tracking-[0.12em] ${message.error ? "text-destructive" : "text-primary"}`}>{AGENTS[message.agent!].label}{message.error ? " · error" : ""}</div>
            {message.pending && !message.text ? <span className="animate-pulse text-muted-foreground">thinking…</span> : message.error ? message.text : <MessageText text={message.text} />}
          </div>
        </div>
      ))}
    </>
  )
}
