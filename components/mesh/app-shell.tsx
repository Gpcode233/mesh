"use client"

import { useRef, useState, type FormEvent, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { IconArrowUpRight, IconCheck, IconLogout, IconWallet, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Logo, MobileNav, Sidebar } from "@/components/mesh/sidebar"
import { useMesh } from "@/components/mesh/mesh-provider"
import { Field } from "@/components/mesh/parts"

gsap.registerPlugin(useGSAP)

export function AppShell({ children }: { children: ReactNode }) {
  const pageRef = useRef<HTMLElement>(null)
  const pathname = usePathname()
  const { wallet, connect, signOut, toast, isModalOpen, setModalOpen, notify } = useMesh()
  const router = useRouter()
  const [formError, setFormError] = useState("")
  const [isSubmitting, setSubmitting] = useState(false)
  // The chat fills the viewport and scrolls inside its own panes; other pages scroll as documents.
  const fullHeight = pathname === "/"

  useGSAP(() => {
    gsap.from(".editorial-reveal", { opacity: 0, y: 18, duration: 0.85, stagger: 0.08, ease: "power3.out" })
  }, { scope: pageRef, dependencies: [pathname] })

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setSubmitting(true)
    setFormError("")
    try {
      const response = await fetch("/api/rfqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: data.get("resource"),
          quantity: Number(data.get("quantity")),
          unit: data.get("unit"),
          maxBudget: Number(data.get("budget")),
          deadline: data.get("deadline"),
          destination: data.get("destination"),
        }),
      })
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(result.error ?? "Unable to create the RFQ.")
      }
      form.reset()
      setModalOpen(false)
      notify("RFQ created.")
      router.refresh()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create the RFQ.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main ref={pageRef} className={`mesh-page bg-background text-foreground ${fullHeight ? "flex h-svh flex-col overflow-hidden" : "min-h-svh"}`}>
      <header className="shrink-0 border-b border-foreground/10 bg-background lg:hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <Logo />
          <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={connect}><IconWallet size={15} />{wallet?.accountId ?? "Connect wallet"}</Button><Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={signOut}><IconLogout size={15} /></Button></div>
        </div>
        <MobileNav />
      </header>

      <div className={`mx-auto flex w-full max-w-[1540px] gap-0 px-3 pt-3 lg:px-5 ${fullHeight ? "min-h-0 flex-1 pb-3" : "pb-16"}`}>
        <Sidebar />
        <div className={`min-w-0 flex-1 ${fullHeight ? "min-h-0 lg:pl-4" : "lg:pl-8"}`}>{children}</div>
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 animate-toast items-center gap-2 rounded-full border border-primary/30 bg-[#172126]/95 px-4 py-2.5 text-xs font-medium text-[#d9f8df] shadow-[0_18px_50px_oklch(0.2_0.05_210/0.25)] backdrop-blur-xl"><IconCheck size={15} className="text-[#9bdba5]" /> {toast}</div>}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between">
              <div><p className="eyebrow">New workflow</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Create RFQ</h2></div>
              <button aria-label="Close" onClick={() => setModalOpen(false)} className="rounded-full p-2 text-muted-foreground hover:bg-muted"><IconX size={18} /></button>
            </div>
            <form onSubmit={submitOrder} className="grid gap-4">
              <Field label="Resource need" name="resource" placeholder="e.g. Industrial lithium" />
              <div className="grid grid-cols-2 gap-4"><Field label="Quantity" name="quantity" type="number" placeholder="240" /><Field label="Unit" name="unit" placeholder="kg" /></div>
              <div className="grid grid-cols-2 gap-4"><Field label="Max budget (USDC)" name="budget" type="number" placeholder="18000" /><Field label="Deadline" name="deadline" type="date" placeholder="Select date" /></div>
              <Field label="Destination" name="destination" placeholder="Fulfillment hub or wallet" />
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button type="submit" disabled={isSubmitting} className="mt-2 w-full">{isSubmitting ? "Creating…" : "Create RFQ"} <IconArrowUpRight size={16} /></Button>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
