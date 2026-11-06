import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { AppShell } from "@/components/mesh/app-shell"
import { MeshProvider } from "@/components/mesh/mesh-provider"
import { getSession } from "@/lib/auth"

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect("/login")
  return (
    <MeshProvider operator={{ name: session.name, email: session.email, role: session.role, orgName: session.orgName }}>
      <AppShell>{children}</AppShell>
    </MeshProvider>
  )
}
