"use client"

import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { AgentEvent } from "@/lib/agent-engine"
import { AGENT_IDS, AGENTS, isAgentId, type AgentId } from "@/lib/agents"
import { newTurnId, requestAgentReply } from "@/lib/chat-client"
import type { ToolStep } from "@/lib/chat-events"
import { registrySeed, starterEvents, type RegistryAgent } from "@/lib/mesh-data"
import type { ApprovalView } from "@/lib/rfq"
import { connectWalletProvider, type WalletProvider } from "@/lib/near"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  agent: AgentId
  error?: boolean
  approval?: ApprovalView | null
  steps?: ToolStep[]
  /** True while the reply is still streaming in. */
  streaming?: boolean
}

export type GroupMessage = {
  id: string
  role: "user" | "agent"
  agent?: AgentId
  text: string
  error?: boolean
  pending?: boolean
}

type Threads = Record<AgentId, ChatMessage[]>
type Flags = Record<AgentId, boolean>
type Contexts = Record<AgentId, string>

export type Operator = { name: string; email: string; role: string; orgName: string }

type StoredMessage = { id: number; channel: string; author: string; content: string; approval: ApprovalView | null; steps: ToolStep[] }

type MeshState = {
  operator: Operator
  historyError: string
  signOut: () => Promise<void>
  events: AgentEvent[]
  registry: RegistryAgent[]
  wallet: WalletProvider | null
  isFrozen: boolean
  isFreezing: boolean
  toast: string
  isModalOpen: boolean
  selectedAgent: AgentId
  threads: Threads
  contexts: Contexts
  pending: Flags
  group: GroupMessage[]
  groupBusy: boolean
  setModalOpen: (open: boolean) => void
  setSelectedAgent: (agent: AgentId) => void
  setAgentContext: (agent: AgentId, value: string) => void
  /** Opens the wallet picker if needed; resolves to the connected wallet, or null if cancelled. */
  connect: () => Promise<WalletProvider | null>
  /** Freezes or unfreezes procurement on the server. Unfreezing needs an owner. */
  setProcurementFrozen: (frozen: boolean) => Promise<void>
  simulateIntent: () => void
  simulateKeyRotation: () => void
  revokeAgent: (agent: AgentId) => void
  updateApproval: (approval: ApprovalView) => void
  sendToAgent: (agent: AgentId, text: string) => Promise<void>
  sendToGroup: (text: string) => Promise<void>
  notify: (message: string) => void
}

const MeshContext = createContext<MeshState | null>(null)

export function useMesh() {
  const value = useContext(MeshContext)
  if (!value) throw new Error("useMesh must be used inside MeshProvider")
  return value
}

let counter = 0
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

function upsertStep(steps: ToolStep[], step: ToolStep) {
  return steps.some((entry) => entry.id === step.id) ? steps.map((entry) => (entry.id === step.id ? step : entry)) : [...steps, step]
}

function emptyRecord<T>(make: () => T): Record<AgentId, T> {
  return Object.fromEntries(AGENT_IDS.map((id) => [id, make()])) as Record<AgentId, T>
}

const greeting: ChatMessage = {
  id: "greeting-head",
  role: "assistant",
  agent: "head",
  text: "I'm the Head Agent. Tell me what you need to buy, with the quantity, budget, deadline and destination, and I'll draft an RFQ for you to approve. Nothing is created until you approve it. You can also ask a specialist directly, or use the group chat to ask all of us at once.",
}

export function MeshProvider({ children, operator, initiallyFrozen }: { children: ReactNode; operator: Operator; initiallyFrozen: boolean }) {
  const router = useRouter()
  const [events, setEvents] = useState<AgentEvent[]>(starterEvents)
  const [registry, setRegistry] = useState(registrySeed)
  const [wallet, setWallet] = useState<WalletProvider | null>(null)
  const [isFrozen, setFrozen] = useState(initiallyFrozen)
  const [isFreezing, setFreezing] = useState(false)
  const [toast, setToast] = useState("")
  const [isModalOpen, setModalOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("head")
  const [threads, setThreads] = useState<Threads>(() => ({ ...emptyRecord<ChatMessage[]>(() => []), head: [greeting] }))
  const [contexts, setContexts] = useState<Contexts>(() => emptyRecord(() => ""))
  const [pending, setPending] = useState<Flags>(() => emptyRecord(() => false))
  const [group, setGroup] = useState<GroupMessage[]>([])
  const [groupBusy, setGroupBusy] = useState(false)
  const [historyError, setHistoryError] = useState("")

  // Refs let async senders read the latest values without re-creating callbacks.
  const contextsRef = useRef(contexts)
  const pendingRef = useRef(pending)
  const groupBusyRef = useRef(false)
  const toastTimer = useRef<number | undefined>(undefined)
  // Senders wait on this so a message sent during load is not overwritten by loaded history.
  const historyLoaded = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    contextsRef.current = contexts
    pendingRef.current = pending
  }, [contexts, pending])

  useEffect(() => {
    let cancelled = false
    historyLoaded.current = (async () => {
      try {
        const response = await fetch("/api/conversations")
        if (!response.ok) throw new Error(`status ${response.status}`)
        const { messages } = (await response.json()) as { messages: StoredMessage[] }
        if (cancelled) return
        const nextThreads: Threads = { ...emptyRecord<ChatMessage[]>(() => []), head: [greeting] }
        const nextGroup: GroupMessage[] = []
        for (const row of messages) {
          const isUser = row.author === "user"
          if (!isUser && !isAgentId(row.author)) continue
          if (row.channel === "group") {
            nextGroup.push(isUser
              ? { id: `m-${row.id}`, role: "user", text: row.content }
              : { id: `m-${row.id}`, role: "agent", agent: row.author as AgentId, text: row.content })
            continue
          }
          const agent = row.channel.replace("direct:", "")
          if (!isAgentId(agent)) continue
          nextThreads[agent].push({ id: `m-${row.id}`, role: isUser ? "user" : "assistant", text: row.content, agent, approval: row.approval, steps: row.steps })
        }
        setThreads(nextThreads)
        setGroup(nextGroup)
        setHistoryError("")
      } catch {
        if (!cancelled) setHistoryError("Saved conversations could not be loaded. New messages still send.")
      }
    })()
    return () => { cancelled = true }
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(""), 3200)
  }, [])

  const addEvent = useCallback((level: AgentEvent["level"], message: string, metadata?: string, toastIt = true) => {
    setEvents((current) => [{ id: nextId("evt"), timestamp: Date.now(), level, message, metadata }, ...current].slice(0, 100))
    if (toastIt) notify(message)
  }, [notify])

  // Simulated telemetry, labelled as such.
  useEffect(() => {
    const timer = window.setInterval(() => {
      addEvent("info", "Negotiating price with supplier agent (simulated)", "simulated telemetry", false)
    }, 8500)
    return () => window.clearInterval(timer)
  }, [addEvent])

  const connect = useCallback(async () => {
    try {
      const provider = await connectWalletProvider("testnet")
      if (!provider.accountId) await provider.connect()
      setWallet(provider)
      addEvent("success", `Connected ${provider.accountId}`, "NEAR testnet")
      return provider
    } catch (error) {
      addEvent("error", error instanceof Error ? error.message : "Wallet connection failed.")
      return null
    }
  }, [addEvent])

  const setProcurementFrozen = useCallback(async (frozen: boolean) => {
    setFreezing(true)
    try {
      const response = await fetch("/api/freeze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frozen }) })
      const result = (await response.json().catch(() => ({}))) as { frozen?: boolean; error?: string }
      if (!response.ok || typeof result.frozen !== "boolean") throw new Error(result.error ?? `Freeze request failed (${response.status}).`)
      setFrozen(result.frozen)
      addEvent(result.frozen ? "error" : "info", result.frozen ? "Procurement frozen: selections, approvals and agent drafts are blocked." : "Procurement unfrozen.", "recorded in the audit log")
      router.refresh()
    } catch (error) {
      addEvent("error", error instanceof Error ? error.message : "Freeze request failed.")
    } finally {
      setFreezing(false)
    }
  }, [addEvent, router])

  const simulateIntent = useCallback(() => {
    addEvent("success", "Simulated NEAR Intent (not submitted on-chain).", `sim-${Math.random().toString(16).slice(2, 10)}`)
  }, [addEvent])

  const simulateKeyRotation = useCallback(() => {
    addEvent("info", "Mandate key rotation queued by Guard Watcher (simulated).", "next rotation · 24h")
  }, [addEvent])

  const revokeAgent = useCallback((agent: AgentId) => {
    setRegistry((current) => current.map((entry) => (entry.id === agent ? { ...entry, online: false, expires: "revoked" } : entry)))
    addEvent("error", `${AGENTS[agent].label} mandate revoked locally (no on-chain revoke yet).`, agent)
  }, [addEvent])

  const updateApproval = useCallback((approval: ApprovalView) => {
    // Head drafts RFQs and Scout proposes suppliers, so look in every thread.
    setThreads((current) => Object.fromEntries(Object.entries(current).map(([agent, thread]) => [
      agent,
      thread.map((message) => (message.approval?.id === approval.id ? { ...message, approval } : message)),
    ])) as Threads)
  }, [])

  const setAgentContext = useCallback((agent: AgentId, value: string) => {
    setContexts((current) => ({ ...current, [agent]: value }))
  }, [])

  const signOut = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (!response.ok) throw new Error()
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load resets all client state
      window.location.assign("/login")
    } catch {
      notify("Sign out failed. Try again.")
    }
  }, [notify])

  const sendToAgent = useCallback(async (agent: AgentId, raw: string) => {
    const content = raw.trim()
    if (!content || pendingRef.current[agent]) return
    setPending((current) => ({ ...current, [agent]: true }))
    await historyLoaded.current
    const replyId = nextId("a")
    const patchReply = (patch: (message: ChatMessage) => Partial<ChatMessage>) =>
      setThreads((current) => ({ ...current, [agent]: current[agent].map((message) => (message.id === replyId ? { ...message, ...patch(message) } : message)) }))
    setThreads((current) => ({
      ...current,
      [agent]: [...current[agent], { id: nextId("u"), role: "user", text: content, agent }, { id: replyId, role: "assistant", text: "", agent, steps: [], streaming: true }],
    }))
    try {
      const reply = await requestAgentReply(
        { agent, channel: "direct", content, clientTurnId: newTurnId(), context: contextsRef.current[agent] },
        {
          onText: (delta) => patchReply((message) => ({ text: message.text + delta })),
          onStep: (step) => patchReply((message) => ({ steps: upsertStep(message.steps ?? [], step) })),
        },
      )
      patchReply(() => ({ text: reply.content, approval: reply.approval, steps: reply.steps, streaming: false }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "The agent could not respond."
      // Shown in the thread and in the chat's error banner; a toast would repeat it a third time.
      patchReply(() => ({ text: message, error: true, streaming: false }))
    } finally {
      setPending((current) => ({ ...current, [agent]: false }))
    }
  }, [])

  const sendToGroup = useCallback(async (raw: string) => {
    const content = raw.trim()
    if (!content || groupBusyRef.current) return
    groupBusyRef.current = true
    setGroupBusy(true)
    await historyLoaded.current
    const clientTurnId = newTurnId()
    const placeholders: GroupMessage[] = AGENT_IDS.map((agent) => ({ id: nextId(`gp-${agent}`), role: "agent", agent, text: "", pending: true }))
    setGroup((current) => [...current, { id: nextId("gu"), role: "user", text: content }, ...placeholders])

    // Stagger starts so six simultaneous calls don't trip provider rate limits.
    await Promise.all(placeholders.map(async (placeholder, index) => {
      const agent = placeholder.agent!
      await new Promise((resolve) => setTimeout(resolve, index * 500))
      let patch: Partial<GroupMessage>
      const onText = (delta: string) => setGroup((current) => current.map((message) => (message.id === placeholder.id ? { ...message, text: message.text + delta } : message)))
      try {
        const reply = await requestAgentReply({ agent, channel: "group", content, clientTurnId, context: contextsRef.current[agent] }, { onText })
        patch = { text: reply.content, pending: false }
      } catch (error) {
        patch = { text: error instanceof Error ? error.message : "The agent could not respond.", pending: false, error: true }
      }
      setGroup((current) => current.map((message) => (message.id === placeholder.id ? { ...message, ...patch } : message)))
    }))
    groupBusyRef.current = false
    setGroupBusy(false)
  }, [])

  const value = useMemo<MeshState>(() => ({
    operator, historyError, signOut, events, registry, wallet, isFrozen, isFreezing, toast, isModalOpen, selectedAgent, threads, contexts, pending, group, groupBusy,
    setModalOpen, setSelectedAgent, setAgentContext, connect, setProcurementFrozen, simulateIntent, simulateKeyRotation, revokeAgent, updateApproval, sendToAgent, sendToGroup, notify,
  }), [operator, historyError, signOut, events, registry, wallet, isFrozen, isFreezing, toast, isModalOpen, selectedAgent, threads, contexts, pending, group, groupBusy, setAgentContext, connect, setProcurementFrozen, simulateIntent, simulateKeyRotation, revokeAgent, updateApproval, sendToAgent, sendToGroup, notify])

  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>
}
