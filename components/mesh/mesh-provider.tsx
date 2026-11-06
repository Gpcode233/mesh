"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { parseRfq, type AgentEvent, type RfqRequirement } from "@/lib/agent-engine"
import { AGENT_IDS, AGENTS, isAgentId, type AgentId } from "@/lib/agents"
import { newTurnId, requestAgentReply } from "@/lib/chat-client"
import { initialPipeline, registrySeed, starterEvents, type PipelineItem, type RegistryAgent } from "@/lib/mesh-data"
import { connectWalletProvider, revokeAllAgentKeys, type WalletProvider } from "@/lib/near"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  agent: AgentId
  error?: boolean
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

type StoredMessage = { id: number; channel: string; author: string; content: string }

type MeshState = {
  operator: Operator
  historyError: string
  signOut: () => Promise<void>
  pipeline: PipelineItem[]
  events: AgentEvent[]
  registry: RegistryAgent[]
  wallet: WalletProvider | null
  isFrozen: boolean
  isRevoking: boolean
  toast: string
  isModalOpen: boolean
  formError: string
  selectedAgent: AgentId
  threads: Threads
  contexts: Contexts
  pending: Flags
  group: GroupMessage[]
  groupBusy: boolean
  setModalOpen: (open: boolean) => void
  setSelectedAgent: (agent: AgentId) => void
  setAgentContext: (agent: AgentId, value: string) => void
  connect: () => Promise<void>
  emergencyFreeze: () => Promise<void>
  simulateIntent: () => void
  simulateKeyRotation: () => void
  revokeAgent: (agent: AgentId) => void
  createPurchaseOrder: (input: Partial<RfqRequirement>) => boolean
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

function emptyRecord<T>(make: () => T): Record<AgentId, T> {
  return Object.fromEntries(AGENT_IDS.map((id) => [id, make()])) as Record<AgentId, T>
}

const greeting: ChatMessage = {
  id: "greeting-head",
  role: "assistant",
  agent: "head",
  text: "I'm the Head Agent. Tell me what you need to buy, or switch to a specialist (Scout, Compliance, Negotiator, Settlement, Guard) — or open the group chat to ask all of us at once. I can't execute purchases from chat yet; I'll flag anything that needs your approval.",
}

export function MeshProvider({ children, operator }: { children: ReactNode; operator: Operator }) {
  const [pipeline, setPipeline] = useState(initialPipeline)
  const [events, setEvents] = useState<AgentEvent[]>(starterEvents)
  const [registry, setRegistry] = useState(registrySeed)
  const [wallet, setWallet] = useState<WalletProvider | null>(null)
  const [isFrozen, setFrozen] = useState(false)
  const [isRevoking, setRevoking] = useState(false)
  const [toast, setToast] = useState("")
  const [isModalOpen, setModalOpen] = useState(false)
  const [formError, setFormError] = useState("")
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
          nextThreads[agent].push({ id: `m-${row.id}`, role: isUser ? "user" : "assistant", text: row.content, agent })
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
      await provider.connect()
      setWallet(provider)
      addEvent("success", `Connected ${provider.accountId}`, "NEAR testnet")
    } catch (error) {
      addEvent("error", error instanceof Error ? error.message : "Wallet connection failed.")
    }
  }, [addEvent])

  const emergencyFreeze = useCallback(async () => {
    if (!wallet || isRevoking) return
    setRevoking(true)
    try {
      const transaction = await revokeAllAgentKeys(wallet)
      setFrozen(true)
      setRegistry((current) => current.map((agent) => ({ ...agent, online: false })))
      addEvent("error", "Emergency freeze executed; all mandate keys revoked.", transaction.transactionHash)
    } catch (error) {
      addEvent("error", error instanceof Error ? error.message : "Emergency freeze failed.")
    } finally {
      setRevoking(false)
    }
  }, [addEvent, isRevoking, wallet])

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

  const createPurchaseOrder = useCallback((input: Partial<RfqRequirement>) => {
    try {
      const requirement = parseRfq(input)
      const id = `RFQ-${1043 + pipeline.length}`
      setPipeline((current) => [{ ...requirement, id, status: "Sourcing", supplier: "Awaiting agents", spend: 0 }, ...current])
      addEvent("info", `New RFQ published: ${requirement.resource}`, id)
      setModalOpen(false)
      setFormError("")
      return true
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to publish RFQ.")
      return false
    }
  }, [addEvent, pipeline.length])

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
    setThreads((current) => ({ ...current, [agent]: [...current[agent], { id: nextId("u"), role: "user", text: content, agent }] }))
    try {
      const reply = await requestAgentReply({ agent, channel: "direct", content, clientTurnId: newTurnId(), context: contextsRef.current[agent] })
      setThreads((current) => ({ ...current, [agent]: [...current[agent], { id: nextId("a"), role: "assistant", text: reply, agent }] }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "The agent could not respond."
      setThreads((current) => ({ ...current, [agent]: [...current[agent], { id: nextId("e"), role: "assistant", text: message, agent, error: true }] }))
      notify(message)
    } finally {
      setPending((current) => ({ ...current, [agent]: false }))
    }
  }, [notify])

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
      try {
        const reply = await requestAgentReply({ agent, channel: "group", content, clientTurnId, context: contextsRef.current[agent] })
        patch = { text: reply, pending: false }
      } catch (error) {
        patch = { text: error instanceof Error ? error.message : "The agent could not respond.", pending: false, error: true }
      }
      setGroup((current) => current.map((message) => (message.id === placeholder.id ? { ...message, ...patch } : message)))
    }))
    groupBusyRef.current = false
    setGroupBusy(false)
  }, [])

  const value = useMemo<MeshState>(() => ({
    operator, historyError, signOut, pipeline, events, registry, wallet, isFrozen, isRevoking, toast, isModalOpen, formError, selectedAgent, threads, contexts, pending, group, groupBusy,
    setModalOpen, setSelectedAgent, setAgentContext, connect, emergencyFreeze, simulateIntent, simulateKeyRotation, revokeAgent, createPurchaseOrder, sendToAgent, sendToGroup, notify,
  }), [operator, historyError, signOut, pipeline, events, registry, wallet, isFrozen, isRevoking, toast, isModalOpen, formError, selectedAgent, threads, contexts, pending, group, groupBusy, setAgentContext, connect, emergencyFreeze, simulateIntent, simulateKeyRotation, revokeAgent, createPurchaseOrder, sendToAgent, sendToGroup, notify])

  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>
}
