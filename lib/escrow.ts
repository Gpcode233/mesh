/**
 * Server-only access to the mesh-escrow NEAR contract.
 *
 * Reads go through view calls. The only transactions Mesh signs are `release_milestone` and `freeze`,
 * with the operator's function-call key (MESH_NEAR_OPERATOR_PRIVATE_KEY), which cannot attach deposits
 * or call any other method. Funding is signed by the owner in their own wallet; Mesh only verifies it.
 *
 * Every result reported as done here was read back from the chain at FINAL finality.
 */
import { createHash } from "node:crypto"
import { Account } from "@near-js/accounts"
import type { KeyPairString } from "@near-js/crypto"
import { JsonRpcProvider } from "@near-js/providers"
import { KeyPairSigner } from "@near-js/signers"
import { actionCreators, encodeTransaction, type Action } from "@near-js/transactions"
import { baseEncode } from "@near-js/utils"

const TGAS = BigInt(10) ** BigInt(12)

export type EscrowNetwork = "testnet" | "mainnet"

export type EscrowConfig = {
  network: EscrowNetwork
  contractId: string
  operatorAccountId: string
  rpcUrl: string
  explorerUrl: string
}

export type ChainMilestone = { amount: string; status: "Pending" | "Releasing" | "Released" | "Refunded"; evidence_hash: string | null }
export type ChainOrder = { supplier: string; funded_by: string; milestones: ChainMilestone[] }
export type ChainConfig = { owner: string; frozen: boolean }

/** A chain or RPC failure, with a message safe to show the operator. */
export class EscrowError extends Error {
  constructor(message: string, readonly kind: "refused" | "unknown" | "config") {
    super(message)
  }
}

const RPC: Record<EscrowNetwork, string> = { testnet: "https://test.rpc.fastnear.com", mainnet: "https://rpc.mainnet.fastnear.com" }
const EXPLORER: Record<EscrowNetwork, string> = { testnet: "https://testnet.nearblocks.io", mainnet: "https://nearblocks.io" }

/** Null when no contract is configured: escrow features then say so instead of pretending. */
export function getEscrowConfig(): EscrowConfig | null {
  const contractId = process.env.MESH_ESCROW_CONTRACT_ID?.trim()
  if (!contractId) return null
  const network: EscrowNetwork = process.env.MESH_NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet"
  return {
    network,
    contractId,
    operatorAccountId: process.env.MESH_NEAR_OPERATOR_ACCOUNT_ID?.trim() || contractId,
    rpcUrl: process.env.MESH_NEAR_RPC_URL?.trim() || RPC[network],
    explorerUrl: EXPLORER[network],
  }
}

function requireConfig() {
  const config = getEscrowConfig()
  if (!config) throw new EscrowError("No escrow contract is configured on this server (MESH_ESCROW_CONTRACT_ID is not set).", "config")
  return config
}

let cached: { url: string; provider: JsonRpcProvider } | null = null
function provider(config: EscrowConfig) {
  if (cached?.url !== config.rpcUrl) cached = { url: config.rpcUrl, provider: new JsonRpcProvider({ url: config.rpcUrl }) }
  return cached.provider
}

// One Account instance, so its nonce manager serializes the operator key's nonces across requests.
let operator: { key: string; account: Account } | null = null
function operatorAccount(config: EscrowConfig) {
  const key = process.env.MESH_NEAR_OPERATOR_PRIVATE_KEY?.trim()
  if (!key) throw new EscrowError("The operator key is not configured on this server (MESH_NEAR_OPERATOR_PRIVATE_KEY is not set). Nothing was sent.", "config")
  if (operator?.key !== key) {
    operator = { key, account: new Account(config.operatorAccountId, provider(config), KeyPairSigner.fromSecretKey(key as KeyPairString)) }
  }
  return operator.account
}

async function view<T>(method: string, args: Record<string, unknown>): Promise<T | null> {
  const config = requireConfig()
  try {
    const result = await provider(config).callFunction<T & object>(config.contractId, method, args, { finality: "final" })
    return (result ?? null) as T | null
  } catch (error) {
    throw new EscrowError(`Could not read the escrow contract: ${messageOf(error)}`, "unknown")
  }
}

export type ChainMandate = { operator: string; daily_cap: string; expires_at: string; spent_today: string; day: number }

export const viewEscrowConfig = () => view<ChainConfig>("get_config", {})
export const viewEscrowOrder = (orderId: string) => view<ChainOrder>("get_order", { order_id: orderId })
export const viewEscrowMandate = () => view<ChainMandate>("get_mandate", {})

/** True if `txHash`, signed by the operator, reached FINAL without failure. Used to reconcile a payout after a crash. */
export async function operatorTxSucceeded(txHash: string) {
  const config = requireConfig()
  try {
    const outcome = (await provider(config).viewTransactionStatus(txHash, config.operatorAccountId, "FINAL")) as unknown as TxOutcome
    return !failureOf(outcome) && lastReceiptValue(outcome) !== false
  } catch {
    return false
  }
}

/**
 * The hash recorded on-chain for a payout: sha256 of the evidence URL, as hex (64 chars, within the
 * contract's 128). It records which evidence was cited; it does not prove what the page contained.
 */
export function evidenceHash(uri: string) {
  return createHash("sha256").update(uri).digest("hex")
}

type TxOutcome = {
  final_execution_status?: string
  status: { SuccessValue?: string; Failure?: unknown } | string
  transaction: { signer_id: string; receiver_id: string; hash: string; actions: unknown[] }
  receipts_outcome?: Array<{ outcome: { status: unknown; logs?: string[] } }>
}

/**
 * Verifies that `txHash` is a FINAL, successful `fund_order` call by `owner` on the escrow contract for
 * `orderId`. Throws with the reason otherwise. The caller still reads the order back with get_order.
 */
export async function verifyFundingTx(txHash: string, owner: string, orderId: string) {
  const config = requireConfig()
  let outcome: TxOutcome
  try {
    outcome = (await provider(config).viewTransactionStatus(txHash, owner, "FINAL")) as unknown as TxOutcome
  } catch (error) {
    throw new EscrowError(`That transaction was not found on ${config.network} as signed by ${owner}: ${messageOf(error)}`, "refused")
  }
  const { transaction } = outcome
  if (transaction.signer_id !== owner) throw new EscrowError(`That transaction was signed by ${transaction.signer_id}, not the escrow owner ${owner}.`, "refused")
  if (transaction.receiver_id !== config.contractId) throw new EscrowError(`That transaction called ${transaction.receiver_id}, not the escrow contract ${config.contractId}.`, "refused")
  const call = transaction.actions.map(functionCallOf).find((entry) => entry?.method_name === "fund_order")
  if (!call) throw new EscrowError("That transaction did not call fund_order.", "refused")
  if (call.args.order_id !== orderId) throw new EscrowError("That transaction funded a different order.", "refused")
  const failure = failureOf(outcome)
  if (failure) throw new EscrowError(`The funding transaction failed on-chain: ${failure}`, "refused")
  return { hash: transaction.hash }
}

/**
 * Signs and sends `release_milestone` with the operator key and waits for FINAL. `onSubmit` receives the
 * transaction hash before it is sent, so a crash mid-flight can be reconciled later.
 * Returns the hash only if the payout succeeded; throws EscrowError otherwise.
 */
export async function releaseMilestoneOnChain(input: { orderId: string; index: number; evidenceHash: string; onSubmit: (hash: string) => Promise<void> }) {
  const config = requireConfig()
  const account = operatorAccount(config)
  const action = actionCreators.functionCall("release_milestone", { order_id: input.orderId, index: input.index, evidence_hash: input.evidenceHash }, TGAS * BigInt(60), BigInt(0))
  return sendFinal(config, account, action, input.onSubmit, (outcome) => {
    // on_release returns false when the transfer to the supplier failed and the milestone was rolled back.
    const last = lastReceiptValue(outcome)
    if (last === false) throw new EscrowError("The transfer to the supplier failed, so the contract rolled the payout back. The milestone is still pending.", "refused")
  })
}

/** The operator freezes the contract. Only the owner can unfreeze it, in their own wallet. */
export async function freezeOnChain() {
  const config = requireConfig()
  return sendFinal(config, operatorAccount(config), actionCreators.functionCall("freeze", {}, TGAS * BigInt(10), BigInt(0)), async () => {}, () => {})
}

async function sendFinal(config: EscrowConfig, account: Account, action: Action, onSubmit: (hash: string) => Promise<void>, check: (outcome: TxOutcome) => void) {
  let signed
  try {
    signed = await account.createSignedTransaction(config.contractId, [action])
  } catch (error) {
    throw new EscrowError(`Could not prepare the transaction: ${messageOf(error)}. Nothing was sent.`, "refused")
  }
  const hash = baseEncode(createHash("sha256").update(encodeTransaction(signed.transaction)).digest())
  await onSubmit(hash)
  let outcome: TxOutcome
  try {
    outcome = (await provider(config).sendTransactionUntil(signed, "FINAL")) as unknown as TxOutcome
  } catch (error) {
    const reason = messageOf(error)
    // A panic inside the contract arrives as an RPC error from some providers.
    if (/panicked|Smart contract/i.test(reason)) throw new EscrowError(`The contract refused it: ${panicOf(reason)}`, "refused")
    throw new EscrowError(`The transaction was sent but its outcome is not known yet (${reason}). Retry to check the chain.`, "unknown")
  }
  const failure = failureOf(outcome)
  if (failure) throw new EscrowError(`The contract refused it: ${failure}`, "refused")
  check(outcome)
  return { hash }
}

function functionCallOf(action: unknown): { method_name: string; args: Record<string, unknown> } | null {
  const call = (action as { FunctionCall?: { method_name?: string; args?: string } } | null)?.FunctionCall
  if (!call?.method_name) return null
  try {
    return { method_name: call.method_name, args: JSON.parse(Buffer.from(call.args ?? "", "base64").toString("utf8")) }
  } catch {
    return { method_name: call.method_name, args: {} }
  }
}

/** The first failure in the transaction or any of its receipts, as readable text. */
function failureOf(outcome: TxOutcome): string | null {
  const statuses = [outcome.status, ...(outcome.receipts_outcome ?? []).map((receipt) => receipt.outcome.status)]
  for (const status of statuses) {
    const failure = (status as { Failure?: unknown } | null)?.Failure
    if (failure) return panicOf(JSON.stringify(failure))
  }
  return null
}

function lastReceiptValue(outcome: TxOutcome): unknown {
  const value = (outcome.status as { SuccessValue?: string }).SuccessValue
  if (!value) return undefined
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"))
  } catch {
    return undefined
  }
}

/** "Smart contract panicked: Escrow is frozen" -> "Escrow is frozen". */
function panicOf(text: string) {
  const match = /Smart contract panicked: ([^"\\}]+)/.exec(text) ?? /ExecutionError"?:?\s*"?([^"}]+)/.exec(text)
  return (match?.[1] ?? text).trim().slice(0, 300)
}

function messageOf(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}
