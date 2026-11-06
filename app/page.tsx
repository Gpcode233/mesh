 hand"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import {
  IconActivity,
  IconArrowUpRight,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconCircleDot,
  IconCode,
  IconCoins,
  IconCommand,
  IconFileInvoice,
  IconLock,
  IconMapPin,
  IconMessageCircle,
  IconNetwork,
  IconLayoutDashboard,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
  IconTerminal2,
  IconWallet,
  IconX,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { parseRfq, type AgentEvent, type RfqRequirement } from "@/lib/agent-engine"
import { connectWalletProvider, revokeAllAgentKeys, type WalletProvider } from "@/lib/near"

gsap.registerPlugin(useGSAP)

type PipelineItem = RfqRequirement & {
  id: string
  status: "Sourcing" | "Bidding" | "Settled"
  supplier: string
  spend: number
}

type AgentId = "head" | "scout" | "compliance" | "negotiator" | "settlement" | "guard"
type ChatMessage = { role: "user" | "assistant"; text: string; agent?: AgentId }

const initialPipeline: PipelineItem[] = [
  { id: "RFQ-1042", resource: "Lithium carbonate", quantity: 240, unit: "kg", maxBudget: 18400, deadline: "Nov 08", destination: "Rotterdam hub", status: "Bidding", supplier: "3 active bids", spend: 0 },
  { id: "RFQ-1041", resource: "Solar micro-inverters", quantity: 80, unit: "units", maxBudget: 9600, deadline: "Nov 12", destination: "Austin hub", status: "Sourcing", supplier: "Awaiting agents", spend: 0 },
  { id: "RFQ-1039", resource: "Recycled copper wire", quantity: 1200, unit: "m", maxBudget: 7200, deadline: "Nov 06", destination: "Osaka hub", status: "Settled", supplier: "Mori Metals", spend: 6980 },
]

const starterEvents: AgentEvent[] = [
  { id: "1", timestamp: Date.now() - 180000, level: "success", message: "Intent settled on destination chain", metadata: "0x8f2...c91" },
  { id: "2", timestamp: Date.now() - 420000, level: "info", message: "Scout-07 found 3 matching suppliers", metadata: "RFQ-1042" },
  { id: "3", timestamp: Date.now() - 800000, level: "info", message: "TEE attestation verified", metadata: "quote-engine-v2" },
]

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(timestamp)
}

export default function Page() {
  const pageRef = useRef<HTMLElement>(null)
  const [pipeline, setPipeline] = useState(initialPipeline)
  const [events, setEvents] = useState(starterEvents)
  const [wallet, setWallet] = useState<WalletProvider | null>(null)
  const [isModalOpen, setModalOpen] = useState(false)
  const [isTerminalOpen, setTerminalOpen] = useState(true)
  const [isFrozen, setFrozen] = useState(false)
  const [isRevoking, setRevoking] = useState(false)
  const [formError, setFormError] = useState("")
  const [toast, setToast] = useState("")
  const [activePage, setActivePage] = useState<"overview" | "agent" | "network" | "settlements">("overview")
  const [chatInput, setChatInput] = useState("")
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("head")
  const [agentContext, setAgentContext] = useState("")
  const [isChatting, setChatting] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", agent: "head", text: "Good morning. I’m monitoring 12 active mandates and 2 purchase orders that need attention. What should we move first?" },
  ])

  useGSAP(() => {
    gsap.from(".editorial-reveal", {
      opacity: 0,
      y: 18,
      duration: 0.85,
      stagger: 0.08,
      ease: "power3.out",
    })
  }, { scope: pageRef })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEvents((current) => [
        { id: `${Date.now()}`, timestamp: Date.now(), level: "info" as const, message: "Negotiating price with supplier agent", metadata: "Scout-07 → Bidder-12" },
        ...current,
      ].slice(0, 7))
    }, 8500)
    return () => window.clearInterval(timer)
  }, [])

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(""), 3200)
  }

  function addEvent(level: AgentEvent["level"], message: string, metadata?: string) {
    setEvents((current) => [{ id: `${Date.now()}`, timestamp: Date.now(), level, message, metadata }, ...current].slice(0, 7))
    notify(message)
  }

  async function connect() {
    const provider = await connectWalletProvider("testnet")
    await provider.connect()
    setWallet(provider)
    addEvent("success", `Connected ${provider.accountId}`, "NEAR testnet")
  }

  async function emergencyFreeze() {
    if (!wallet || isRevoking) return
    setRevoking(true)
    try {
      const transaction = await revokeAllAgentKeys(wallet)
      setFrozen(true)
      addEvent("error", "Emergency freeze executed; all mandate keys revoked.", transaction.transactionHash)
    } finally {
      setRevoking(false)
    }
  }

  function simulateIntent() {
    addEvent("success", "NEAR Intent submitted for stablecoin settlement.", `intent-${Math.random().toString(16).slice(2, 10)}`)
  }

  function simulateKeyRotation() {
    addEvent("info", "Mandate key rotation queued by Guard Watcher.", "next rotation · 24h")
  }

  async function createPurchaseOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const requirement = parseRfq({
        resource: String(form.get("resource")),
        quantity: Number(form.get("quantity")),
        unit: String(form.get("unit")),
        maxBudget: Number(form.get("budget")),
        deadline: String(form.get("deadline")),
        destination: String(form.get("destination")),
      })
      const id = `RFQ-${1043 + pipeline.length}`
      setPipeline((current) => [{ ...requirement, id, status: "Sourcing", supplier: "Awaiting agents", spend: 0 }, ...current])
      addEvent("info", `New RFQ published: ${requirement.resource}`, id)
      setModalOpen(false)
      setFormError("")
      event.currentTarget.reset()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to publish RFQ.")
    }

  }

  async function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = chatInput.trim()
    if (!message || isChatting) return
    const nextMessages = [...chatMessages, { role: "user" as const, text: message, agent: selectedAgent }]
    setChatMessages(nextMessages)
    setChatInput("")
    setChatting(true)
    try {
      const response = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: selectedAgent,
          context: agentContext,
          messages: nextMessages.map(({ role, text }) => ({ role, content: text })),
        }),
      })
      const result = await response.json() as { content?: string; error?: string }
      if (!response.ok || !result.content) throw new Error(result.error ?? "The agent did not respond.")
      setChatMessages((current) => [...current, { role: "assistant", text: result.content!, agent: selectedAgent }])
    } catch (error) {
      const text = error instanceof Error ? error.message : "The agent could not respond."
      setChatMessages((current) => [...current, { role: "assistant", text: `Connection issue: ${text}`, agent: selectedAgent }])
      notify(text)
    } finally {
      setChatting(false)
    }
  }

  return (
    <main ref={pageRef} className="mesh-page min-h-svh bg-background text-foreground">
      <header className="editorial-reveal border-b border-foreground/10 bg-background lg:hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.03em]"><span className="grid size-7 place-items-center rounded-full bg-foreground text-background"><IconBolt size={14} /></span>mesh</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex"><span className="size-1.5 animate-pulse rounded-full bg-[#39a96b]" /> Testnet live</span>
            <Button variant="outline" size="sm" onClick={connect}><IconWallet size={15} />{wallet?.accountId ?? "Connect wallet"}</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1540px] gap-0 px-3 pb-16 pt-3 lg:px-5">
        <aside className="glass-sidebar sticky top-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col rounded-2xl p-4 lg:flex">
          <div className="flex items-center gap-2 px-2 py-2 text-[15px] font-semibold tracking-[-0.03em]"><span className="grid size-7 place-items-center rounded-full bg-foreground text-background"><IconBolt size={14} /></span>mesh</div>
          <div className="mt-10"><p className="eyebrow px-3">Workspace</p><nav className="mt-3 grid gap-1">
            <SidebarItem active={activePage === "overview"} icon={<IconLayoutDashboard size={17} />} label="Overview" onClick={() => setActivePage("overview")} />
            <SidebarItem active={activePage === "agent"} icon={<IconMessageCircle size={17} />} label="Head agent" onClick={() => setActivePage("agent")} badge="LIVE" />
            <SidebarItem active={activePage === "network"} icon={<IconNetwork size={17} />} label="Supplier network" onClick={() => setActivePage("network")} />
            <SidebarItem active={activePage === "settlements"} icon={<IconCoins size={17} />} label="Settlements" onClick={() => setActivePage("settlements")} />
          </nav></div>
          <div className="mt-auto border-t border-foreground/10 pt-4"><div className="mb-4 flex items-center gap-2 px-3 text-[11px] text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-[#39a96b]" /> Testnet live</div><Button variant="outline" size="sm" className="w-full justify-start" onClick={connect}><IconWallet size={15} />{wallet?.accountId ? "Wallet connected" : "Connect wallet"}</Button></div>
        </aside>
        <div className="min-w-0 flex-1 lg:pl-8">
        {activePage === "agent" ? <AgentWorkspace messages={chatMessages} input={chatInput} setInput={setChatInput} onSubmit={sendChat} onAction={simulateIntent} selectedAgent={selectedAgent} setSelectedAgent={setSelectedAgent} agentContext={agentContext} setAgentContext={setAgentContext} isChatting={isChatting} /> : activePage !== "overview" ? <WorkspacePanel page={activePage} /> : <div className="mx-auto max-w-[1440px] px-3 pb-16 pt-10 lg:px-6 lg:pt-12">
        <section className="editorial-reveal grid gap-8 border-b border-foreground/10 pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="eyebrow">Operator console / November 06, 2026</p>
            <h1 className="mt-5 max-w-3xl text-[clamp(2.6rem,6vw,5.75rem)] font-semibold leading-[0.92] tracking-[-0.075em]">Procurement that<br /><span className="text-muted-foreground">moves itself.</span></h1>
            <p className="mt-7 max-w-xl text-[15px] leading-7 text-muted-foreground">Mesh agents source, negotiate, verify, and settle your next purchase order—within the rules you set.</p>
          </div>
          <div className="flex items-center gap-3 lg:pb-1"><Button onClick={() => setModalOpen(true)}><IconPlus size={16} /> New purchase order</Button><Button variant="outline" size="icon" aria-label="Open command menu"><IconCommand size={17} /></Button></div>
        </section>

        <section className="editorial-reveal grid border-b border-foreground/10 md:grid-cols-4">
          <Metric label="Active mandates" value={isFrozen ? "00" : "12"} detail={isFrozen ? "Frozen by operator" : "2 expiring this week"} icon={<IconLock size={16} />} />
          <Metric label="Committed spend" value={isFrozen ? "$0" : "$42,180"} detail="82% under daily cap" icon={<IconCoins size={16} />} />
          <Metric label="Open purchase orders" value={String(pipeline.filter((item) => item.status !== "Settled").length).padStart(2, "0")} detail="+4.2% this week" icon={<IconFileInvoice size={16} />} />
          <Metric label="Guard status" value={isFrozen ? "Frozen" : "Healthy"} detail={isFrozen ? "Manual review required" : "Velocity nominal"} icon={<IconShieldCheck size={16} />} alert={isFrozen} />
        </section>

        <section className="editorial-reveal mt-10 grid gap-10 xl:grid-cols-[1fr_350px]">
          <div>
            <div className="mb-5 flex items-end justify-between"><div><p className="eyebrow">01 / Procurement pipeline</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">Orders in flight</h2></div><Button variant="ghost" size="sm"><IconRefresh size={15} /> Refresh</Button></div>
            <div className="overflow-hidden rounded-2xl border border-foreground/10 bg-card/55 backdrop-blur-xl">
              <div className="hidden grid-cols-[1.1fr_1.7fr_0.8fr_0.8fr_1fr] border-b border-foreground/10 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid"><span>Order</span><span>Need</span><span>Budget</span><span>Status</span><span className="text-right">Agent</span></div>
              {pipeline.map((item) => <div key={item.id} className="grid gap-3 border-b border-foreground/8 px-5 py-5 transition-colors last:border-0 hover:bg-accent/25 md:grid-cols-[1.1fr_1.7fr_0.8fr_0.8fr_1fr] md:items-center"><div><span className="font-mono text-xs font-medium">{item.id}</span><span className="mt-1 block text-[11px] text-muted-foreground">Due {item.deadline}</span></div><div><span className="text-sm font-medium">{item.resource}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.quantity.toLocaleString()} {item.unit} · {item.destination}</span></div><span className="font-mono text-xs">${item.maxBudget.toLocaleString()}</span><span><Badge variant={item.status === "Settled" ? "default" : "secondary"}><IconCircleDot size={10} /> {item.status}</Badge></span><span className="text-right text-xs text-muted-foreground">{item.supplier}</span></div>)}
            </div>
          </div>

          <aside className="editorial-reveal rounded-2xl bg-[#141b1d] p-6 text-[#ecf3ec] shadow-[0_24px_70px_oklch(0.2_0.04_210/0.18)]">
            <div className="flex items-start justify-between"><div><p className="eyebrow text-[#93a39d]">02 / Safety control</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.04em]">Guard Watcher</h2></div><span className={`grid size-9 place-items-center rounded-full ${isFrozen ? "bg-[#f18b76]/20 text-[#f18b76]" : "bg-[#c6e8cd] text-[#31563b]"}`}><IconShieldCheck size={18} /></span></div>
            <div className="mt-8 border-y border-white/10 py-5"><div className="flex justify-between text-[11px] text-[#93a39d]"><span>Daily velocity</span><span>$42,180 / $50,000</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full bg-[#a7ddb0] transition-all duration-700 ${isFrozen ? "w-0" : "w-[84%]"}`} /></div></div>
            <div className="space-y-4 py-5 text-xs"><StatusRow label="Spending velocity" value={isFrozen ? "Paused" : "Nominal"} /><StatusRow label="Key rotation" value="Every 24h" /><StatusRow label="TEE attestation" value="Verified" /></div>
            <Button className="mt-3 w-full bg-[#f18b76] text-[#321714] hover:bg-[#ff9d89]" onClick={emergencyFreeze} disabled={!wallet || isRevoking || isFrozen}>{isRevoking ? "Revoking keys..." : isFrozen ? "All keys revoked" : "Revoke all keys & freeze"}</Button>
            {!wallet && <p className="mt-3 text-center text-[11px] text-[#93a39d]">Connect wallet to enable emergency controls.</p>}
          </aside>
        </section>

        <section className="editorial-reveal mt-12 grid gap-10 border-t border-foreground/10 pt-10 lg:grid-cols-[1fr_0.85fr]">
          <div><p className="eyebrow">03 / Network economics</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">Value captured by execution</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Every settled order compounds the supplier graph and routes more volume through the agent economy.</p><div className="mt-7 grid grid-cols-3 gap-3"><EconomyMetric label="Routed volume" value="$1.84M" detail="+18.6%" /><EconomyMetric label="Buyer savings" value="$96.4K" detail="5.2% avg." /><EconomyMetric label="Mesh fees" value="$9.2K" detail="0.5% take" /></div></div>
          <div className="rounded-2xl border border-foreground/10 bg-card/55 p-5 backdrop-blur-xl"><div className="flex items-center justify-between"><span className="eyebrow">Settlement mix</span><span className="font-mono text-[11px] text-primary">LIVE / 35 CHAINS</span></div><div className="mt-6 space-y-5"><SettlementRow label="NEAR" detail="Native settlement" share="82%" /><SettlementRow label="Ethereum" detail="USDC liquidity" share="11%" /><SettlementRow label="Solana" detail="Supplier payouts" share="7%" /></div></div>
        </section>

        <section className="editorial-reveal mt-12 grid gap-10 border-t border-foreground/10 pt-10 lg:grid-cols-[1fr_0.85fr]">
          <div><div className="flex items-end justify-between"><div><p className="eyebrow">04 / Supplier intelligence</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">The network gets smarter</h2></div><IconMapPin size={19} className="text-primary" /></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{[["Mori Metals", "98.4%", "On-time delivery"], ["Helio Components", "96.1%", "Quote accuracy"], ["Nordic Materials", "94.8%", "Quality pass rate"], ["Aster Logistics", "92.7%", "Response rate"]].map(([name, score, detail]) => <div key={name} className="flex items-center justify-between border-b border-foreground/10 py-4"><div><p className="text-sm font-medium">{name}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div><span className="font-mono text-sm text-primary">{score}</span></div>)}</div></div>
          <div><div className="flex items-end justify-between"><div><p className="eyebrow">05 / Activity stream</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.045em]">Signed events</h2></div><Badge variant="outline"><span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-[#39a96b]" />Live</Badge></div><div className="mt-6 space-y-4">{events.slice(0, 4).map((event) => <div key={event.id} className="flex gap-3"><span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${event.level === "error" ? "bg-destructive/10 text-destructive" : "bg-accent text-primary"}`}>{event.level === "success" ? <IconCheck size={13} /> : <IconActivity size={13} />}</span><div className="min-w-0"><p className="truncate text-sm">{event.message}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{formatTime(event.timestamp)} · {event.metadata}</p></div></div>)}</div></div>
        </section>

        <section className="editorial-reveal mt-12 overflow-hidden rounded-2xl bg-[#101719] text-[#d9e3d7]">
          <button onClick={() => setTerminalOpen((open) => !open)} className="flex w-full items-center justify-between border-b border-white/10 px-5 py-4 text-left"><span className="flex items-center gap-2 text-sm"><IconTerminal2 size={16} className="text-[#9bdba5]" /> Live agent operations <Badge variant="outline" className="border-white/15 text-[#9bdba5]">TEE STREAM</Badge></span><IconChevronDown size={16} className={`transition-transform ${isTerminalOpen ? "rotate-180" : ""}`} /></button>
          {isTerminalOpen && <div className="grid gap-6 p-5 lg:grid-cols-[1fr_280px]"><div className="space-y-3 font-mono text-xs">{events.slice(0, 5).map((event) => <div key={event.id} className="flex gap-3"><span className="text-white/25">{formatTime(event.timestamp)}</span><span className="text-[#9bdba5]">›</span><span>{event.message} <span className="text-white/35">{event.metadata}</span></span></div>)}</div><div className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="mb-4 flex items-center gap-2 text-[#9bdba5]"><IconCode size={15} /> Runtime telemetry</div><div className="space-y-3 text-xs text-white/55"><div className="flex justify-between"><span>Intent routing</span><span className="text-[#9bdba5]">online</span></div><div className="flex justify-between"><span>Chain signatures</span><span className="text-[#9bdba5]">ready</span></div><div className="flex justify-between"><span>Attestation</span><span className="text-[#9bdba5]">verified</span></div></div><div className="mt-5 grid gap-2"><Button variant="outline" size="xs" className="justify-start border-white/15 bg-white/5 text-[#d9e3d7] hover:bg-white/10 hover:text-white" onClick={simulateIntent}><IconArrowUpRight size={14} /> Simulate Intent</Button><Button variant="outline" size="xs" className="justify-start border-white/15 bg-white/5 text-[#d9e3d7] hover:bg-white/10 hover:text-white" onClick={simulateKeyRotation}><IconRefresh size={14} /> Rotate mandate key</Button></div></div></div>}
        </section>
      </div>
      }
      </div>
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 animate-toast items-center gap-2 rounded-full border border-primary/30 bg-[#172126]/95 px-4 py-2.5 text-xs font-medium text-[#d9f8df] shadow-[0_18px_50px_oklch(0.2_0.05_210/0.25)] backdrop-blur-xl"><IconCheck size={15} className="text-[#9bdba5]" /> {toast}</div>}
      {isModalOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-2xl"><div className="mb-6 flex items-start justify-between"><div><p className="eyebrow">New workflow</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Create purchase order</h2></div><button onClick={() => setModalOpen(false)} className="rounded-full p-2 text-muted-foreground hover:bg-muted"><IconX size={18} /></button></div><form onSubmit={createPurchaseOrder} className="grid gap-4"><Field label="Resource need" name="resource" placeholder="e.g. Industrial lithium" /><div className="grid grid-cols-2 gap-4"><Field label="Quantity" name="quantity" type="number" placeholder="240" /><Field label="Unit" name="unit" placeholder="kg" /></div><div className="grid grid-cols-2 gap-4"><Field label="Max budget (USDC)" name="budget" type="number" placeholder="18000" /><Field label="Deadline" name="deadline" type="date" placeholder="Select date" /></div><Field label="Destination" name="destination" placeholder="Fulfillment hub or wallet" />{formError && <p className="text-sm text-destructive">{formError}</p>}<Button type="submit" className="mt-2 w-full">Publish to agent network <IconArrowUpRight size={16} /></Button></form></div></div>}
    </main>
  )
}

function SidebarItem({ active, icon, label, badge, onClick }: { active: boolean; icon: React.ReactNode; label: string; badge?: string; onClick: () => void }) {
  return <button onClick={onClick} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200 ${active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}><span className={active ? "text-background" : "text-primary"}>{icon}</span><span className="flex-1">{label}</span>{badge && <span className={`text-[9px] font-semibold tracking-wider ${active ? "text-[#a7ddb0]" : "text-primary"}`}>{badge}</span>}</button>
}

function AgentWorkspace({ messages, input, setInput, onSubmit, onAction, selectedAgent, setSelectedAgent, agentContext, setAgentContext, isChatting }: { messages: ChatMessage[]; input: string; setInput: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onAction: () => void; selectedAgent: AgentId; setSelectedAgent: (agent: AgentId) => void; agentContext: string; setAgentContext: (value: string) => void; isChatting: boolean }) {
  const agents: Array<{ id: AgentId; label: string; detail: string }> = [
    { id: "head", label: "Head agent", detail: "Orchestration" },
    { id: "scout", label: "Scout", detail: "Supplier discovery" },
    { id: "compliance", label: "Compliance", detail: "Risk & evidence" },
    { id: "negotiator", label: "Negotiator", detail: "Quotes & terms" },
    { id: "settlement", label: "Settlement", detail: "NEAR Intents" },
    { id: "guard", label: "Guard", detail: "Policy & safety" },
  ]
  return <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
    <div className="mb-10 flex items-end justify-between border-b border-foreground/10 pb-8"><div><p className="eyebrow">Head agent / private workspace</p><h1 className="mt-4 text-4xl font-semibold tracking-[-0.065em] md:text-6xl">Ask Mesh<br /><span className="text-muted-foreground">to move it.</span></h1><p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground">Your command layer for procurement, supplier intelligence, and settlement execution.</p></div><div className="hidden items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground sm:flex"><span className="size-2 animate-pulse rounded-full bg-[#39a96b]" /> Agent online · TEE verified</div></div>
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <section className="glass-panel flex min-h-[560px] flex-col rounded-2xl p-5"><div className="flex items-center justify-between border-b border-foreground/10 pb-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-foreground text-background"><IconBolt size={17} /></span><div><p className="text-sm font-medium">Mesh / {agents.find((agent) => agent.id === selectedAgent)?.label}</p><p className="text-[11px] text-muted-foreground">{agents.find((agent) => agent.id === selectedAgent)?.detail} · actual model route</p></div></div><Badge variant="outline">PRIVATE</Badge></div><div className="flex-1 space-y-5 overflow-y-auto py-6">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}><div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "rounded-br-md bg-foreground text-background" : "rounded-bl-md bg-accent/55 text-foreground"}`}><div className={`mb-1 text-[10px] uppercase tracking-[0.12em] ${message.role === "user" ? "text-background/60" : "text-primary"}`}>{message.role === "user" ? "You" : agents.find((agent) => agent.id === message.agent)?.label ?? "Agent"}</div>{message.text}</div></div>)}{isChatting && <div className="text-xs text-muted-foreground">Agent is reasoning…</div>}</div><div className="mb-3 flex flex-wrap gap-2"><button onClick={onAction} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary">Route a settlement</button><button className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary">Review open RFQs</button><button className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary">Check guard status</button></div><div className="mb-3 grid gap-2 rounded-xl border border-border bg-card/60 p-3"><label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" htmlFor="agent-context">Context for this agent</label><textarea id="agent-context" value={agentContext} onChange={(event) => setAgentContext(event.target.value)} placeholder="Add supplier preferences, constraints, or evidence…" rows={2} className="resize-none bg-transparent text-xs leading-5 outline-none placeholder:text-muted-foreground/65" /></div><form onSubmit={onSubmit} className="flex items-center gap-2 rounded-xl border border-border bg-card/70 p-2 focus-within:border-primary"><select aria-label="Specialized agent" value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value as AgentId)} className="max-w-[130px] bg-transparent px-2 text-xs font-medium outline-none"><option value="head">Head agent</option><option value="scout">Scout</option><option value="compliance">Compliance</option><option value="negotiator">Negotiator</option><option value="settlement">Settlement</option><option value="guard">Guard</option></select><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`Ask ${agents.find((agent) => agent.id === selectedAgent)?.label ?? "agent"}…`} className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/65" /><Button size="sm" type="submit" disabled={isChatting}><IconArrowUpRight size={16} /> {isChatting ? "Thinking" : "Send"}</Button></form></section>
      <aside className="space-y-4"><div className="rounded-2xl bg-[#141b1d] p-5 text-[#ecf3ec]"><p className="eyebrow text-[#93a39d]">Agent posture</p><h2 className="mt-3 text-xl font-medium">Bounded autonomy</h2><p className="mt-3 text-xs leading-5 text-[#93a39d]">Mesh can negotiate and route within policy. You approve high-value or irreversible actions.</p><div className="mt-6 space-y-3 text-xs"><StatusRow label="Mandate scope" value="12 active" /><StatusRow label="Spend cap" value="$50,000 / day" /><StatusRow label="Escalation" value="Required > $10k" /></div></div><div className="glass-panel rounded-2xl p-5"><p className="eyebrow">Suggested next moves</p><div className="mt-4 grid gap-3 text-sm"><div className="flex gap-3"><IconSparkles size={16} className="mt-0.5 text-primary" /><span>Compare the 3 lithium bids</span></div><div className="flex gap-3"><IconActivity size={16} className="mt-0.5 text-primary" /><span>Explain today&apos;s spend velocity</span></div><div className="flex gap-3"><IconShieldCheck size={16} className="mt-0.5 text-primary" /><span>Audit the latest settlement</span></div></div></div></aside>
    </div>
  </div>
}

function WorkspacePanel({ page }: { page: "network" | "settlements" }) {
  const isNetwork = page === "network"
  return <div className="mx-auto max-w-[1100px] px-3 pb-16 pt-10 lg:px-6 lg:pt-14">
    <div className="border-b border-foreground/10 pb-8"><p className="eyebrow">{isNetwork ? "Supplier network" : "Settlement operations"}</p><h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] md:text-6xl">{isNetwork ? "Know who delivers." : "Move value cleanly."}</h1><p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground">{isNetwork ? "Verified suppliers, live performance signals, and agent-ready counterparties across every route." : "Track NEAR Intents, chain signatures, and milestone payouts from one execution surface."}</p></div>
    <div className="mt-10 grid gap-5 md:grid-cols-3">{(isNetwork ? [["98.4%", "Average on-time delivery"], ["146", "Verified counterparties"], ["35", "Active corridors"]] : [["$1.84M", "Volume routed"], ["99.2%", "Settlement success"], ["1.2s", "Median finality"]]).map(([value, label]) => <div key={label} className="glass-panel rounded-2xl p-5"><p className="eyebrow">{label}</p><p className="mt-5 text-3xl font-semibold tracking-[-0.06em]">{value}</p><p className="mt-2 text-xs text-primary">Live on testnet</p></div>)}</div>
    <div className="glass-panel mt-5 rounded-2xl p-6"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-accent text-primary">{isNetwork ? <IconNetwork size={18} /> : <IconCoins size={18} />}</span><div><h2 className="font-medium">{isNetwork ? "Network health" : "Recent settlement activity"}</h2><p className="mt-1 text-xs text-muted-foreground">This workspace is connected to the Mesh control plane.</p></div></div><div className="mt-8 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-[82%] rounded-full bg-primary" /></div></div>
  </div>
}

function Metric({ label, value, detail, icon, alert = false }: { label: string; value: string; detail: string; icon: React.ReactNode; alert?: boolean }) {
  return <div className="border-r border-foreground/10 px-0 py-6 first:pr-5 md:px-5 md:first:pl-0"><div className="flex items-center justify-between text-muted-foreground"><span className="eyebrow">{label}</span><span className={alert ? "text-destructive" : "text-primary"}>{icon}</span></div><div className="mt-4 text-3xl font-semibold tracking-[-0.06em]">{value}</div><p className={`mt-1 text-[11px] ${alert ? "text-destructive" : "text-muted-foreground"}`}>{detail}</p></div>
}

function EconomyMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="border-l border-foreground/10 pl-4 first:border-0 first:pl-0"><p className="eyebrow">{label}</p><p className="mt-3 text-2xl font-semibold tracking-[-0.05em]">{value}</p><p className="mt-1 text-xs text-primary">{detail}</p></div>
}

function SettlementRow({ label, detail, share }: { label: string; detail: string; share: string }) {
  return <div><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full bg-primary" />{label}<span className="text-xs text-muted-foreground">{detail}</span></span><span className="font-mono text-xs text-muted-foreground">{share}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: share }} /></div></div>
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs"><span className="text-[#93a39d]">{label}</span><span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#9bdba5]" />{value}</span></div>
}

function Field({ label, name, placeholder, type = "text" }: { label: string; name: string; placeholder: string; type?: string }) {
  return <label className="grid gap-2 text-xs font-medium text-muted-foreground">{label}<input required name={name} type={type} placeholder={placeholder} className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-normal text-foreground outline-none ring-primary/40 placeholder:text-muted-foreground/60 focus:ring-2" /></label>
}
