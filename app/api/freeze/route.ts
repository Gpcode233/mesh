import { asOperator, readJson } from "@/lib/api"
import { DomainError, setFrozen } from "@/lib/procurement"
import { freezeEscrowOnChain } from "@/lib/settlement"

/** POST { frozen: true } freezes procurement and, when configured, the on-chain escrow (owner or operator). Unfreezing is owner-only in-app and requires the owner to unfreeze the contract on-chain. */
export async function POST(request: Request) {
  return asOperator(async (session) => {
    const body = (await readJson(request)) as { frozen?: unknown } | null
    if (typeof body?.frozen !== "boolean") throw new DomainError("Send { frozen: true } or { frozen: false }.", 400)
    const frozenAt = await setFrozen(session, body.frozen)
    const onChain = body.frozen ? await freezeEscrowOnChain(session) : { skipped: true as const }
    return Response.json({ frozen: frozenAt !== null, frozenAt, onChain })
  })
}
