"use client"

import { useState, type FormEvent } from "react"
import { IconBolt } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/mesh/parts"

export function LoginForm() {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      })
      if (response.ok) {
        // Full navigation so the console layout re-checks the new session on the server.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load resets all client state
        window.location.assign("/")
        return
      }
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      setError(result.error ?? "Unable to sign in.")
    } catch {
      setError("Unable to reach Mesh. Check your connection and try again.")
    }
    setBusy(false)
  }

  return (
    <main className="mesh-page grid min-h-svh place-items-center bg-background p-4 text-foreground">
      <div className="glass-panel w-full max-w-sm rounded-2xl p-6">
        <div className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.03em]"><span className="grid size-7 place-items-center rounded-full bg-foreground text-background"><IconBolt size={14} /></span>mesh</div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in</h1>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <Field label="Email" name="email" type="email" placeholder="you@company.com" />
          <Field label="Password" name="password" type="password" placeholder="Your password" />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-2 w-full">{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
      </div>
    </main>
  )
}
