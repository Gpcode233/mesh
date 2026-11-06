import { redirect } from "next/navigation"
import { LoginForm } from "@/components/mesh/login-form"
import { getSession } from "@/lib/auth"

export default async function Page() {
  if (await getSession()) redirect("/")
  return <LoginForm />
}
