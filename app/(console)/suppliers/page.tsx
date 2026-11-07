import { SuppliersView } from "@/components/mesh/suppliers-view"
import { requireSession } from "@/lib/auth"
import { listSuppliers } from "@/lib/procurement"

export default async function Page() {
  const session = await requireSession()
  return <SuppliersView suppliers={await listSuppliers(session.orgId)} />
}
