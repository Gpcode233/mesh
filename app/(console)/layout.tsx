import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/mesh/app-shell"
import { MeshProvider } from "@/components/mesh/mesh-provider"
import { getSession } from "@/lib/auth"
import { getPolicy } from "@/lib/procurement"

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect("/login")
  const policy = await getPolicy(session.orgId)
  return (
    <MeshProvider operator={{ name: session.name, email: session.email, role: session.role, orgName: session.orgName }} initiallyFrozen={policy.frozenAt !== null}>
      <AppShell>{children}</AppShell>
    </MeshProvider>
  )
}
