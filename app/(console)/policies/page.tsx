import { PoliciesView } from "@/components/mesh/policies-view"
import { requireSession } from "@/lib/auth"
import { getPolicy } from "@/lib/procurement"

export default async function Page() {
  const session = await requireSession()
  return <PoliciesView policy={await getPolicy(session.orgId)} canEdit={session.role === "owner"} />
}
