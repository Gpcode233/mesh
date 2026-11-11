"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  IconBolt,
  IconCoins,
  IconFileInvoice,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconMessageCircle,
  IconNetwork,
  IconRobot,
  IconShieldCheck,
  IconWallet,
} from "@tabler/icons-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { useMesh } from "@/components/mesh/mesh-provider"

export const NAV_ITEMS: Array<{ href: string; label: string; icon: ReactNode; badge?: string }> = [
  { href: "/", label: "Chat", icon: <IconMessageCircle size={17} /> },
  { href: "/overview", label: "Overview", icon: <IconLayoutDashboard size={17} /> },
  { href: "/orders", label: "Orders", icon: <IconFileInvoice size={17} /> },
  { href: "/agents", label: "Agents", icon: <IconRobot size={17} /> },
  { href: "/policies", label: "Policies", icon: <IconShieldCheck size={17} /> },
  { href: "/suppliers", label: "Suppliers", icon: <IconNetwork size={17} /> },
  { href: "/settlements", label: "Settlements", icon: <IconCoins size={17} /> },
  { href: "/audit", label: "Audit log", icon: <IconHistory size={17} /> },
]

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}

export function Logo() {
  return <div className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.03em]"><span className="grid size-7 place-items-center rounded-full bg-foreground text-background"><IconBolt size={14} /></span>mesh</div>
}

export function Sidebar() {
  const pathname = usePathname()
  const { wallet, connect, operator, signOut } = useMesh()
  return (
    <aside className="glass-sidebar sticky top-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col rounded-2xl p-4 lg:flex">
      <div className="px-2 py-2"><Logo /></div>
      <div className="mt-8">
        <p className="eyebrow px-3">Workspace</p>
        <nav className="mt-3 grid gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link key={item.href} href={item.href} prefetch={false} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200 ${active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}>
                <span className={active ? "text-background" : "text-primary"}>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.badge && <span className={`text-[9px] font-semibold tracking-wider ${active ? "text-[#a7ddb0]" : "text-primary"}`}>{item.badge}</span>}
              </Link>
            )
          })}
        </nav>
      </div>
      <div className="mt-auto border-t border-foreground/10 pt-4">
        <div className="mb-4 flex items-center gap-2 px-3 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-[#39a96b]" /> NEAR testnet · Meteor wallet</div>
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={connect}><IconWallet size={15} />{wallet?.accountId ? "Wallet connected" : "Connect wallet"}</Button>
        <div className="mt-3 flex items-center justify-between gap-2 px-3">
          <span className="min-w-0"><span className="block truncate text-xs font-medium">{operator.name}</span><span className="block truncate text-[10px] capitalize text-muted-foreground">{operator.role} · {operator.orgName}</span></span>
          <button aria-label="Sign out" onClick={signOut} className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><IconLogout size={15} /></button>
        </div>
      </div>
    </aside>
  )
}

export function MobileNav() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto border-t border-foreground/10 px-3 py-2 lg:hidden">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        return <Link key={item.href} href={item.href} prefetch={false} className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs ${active ? "bg-foreground text-background" : "text-muted-foreground"}`}>{item.label}</Link>
      })}
    </nav>
  )
}
