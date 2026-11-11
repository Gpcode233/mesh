"use client"

import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core"
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet"
import { setupModal } from "@near-wallet-selector/modal-ui"
import "@near-wallet-selector/modal-ui/styles.css"
import { actionCreators } from "@near-js/transactions"

export type NearNetwork = "mainnet" | "testnet"

export type ContractCall = {
  contractId: string
  methodName: string
  args: Record<string, unknown>
  gas?: string
  deposit?: string
}

export type WalletProvider = {
  readonly network: NearNetwork
  readonly accountId: string | null
  connect(): Promise<string>
  signAndSendTransaction(call: ContractCall): Promise<{ transactionHash: string }>
  signOut(): Promise<void>
}

let selectorPromise: Promise<WalletSelector> | null = null

async function getSelector(network: NearNetwork) {
  if (!selectorPromise) {
    selectorPromise = setupWalletSelector({
      network,
      modules: [setupMeteorWallet()],
    })
  }
  return selectorPromise
}

function txHash(outcome: unknown): string {
  const o = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | null
  return o?.transaction?.hash ?? o?.transaction_outcome?.id ?? ""
}

class SelectorWalletProvider implements WalletProvider {
  readonly network: NearNetwork
  accountId: string | null
  constructor(network: NearNetwork, accountId: string | null) {
    this.network = network
    this.accountId = accountId
  }
  async connect() {
    const selector = await getSelector(this.network)
    const modal = setupModal(selector, { contractId: process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID || "" })
    return await new Promise<string>((resolve, reject) => {
      modal.on("onHide", async ({ hideReason }) => {
        const state = selector.store.getState()
        const id = state.accounts.find((a) => a.active)?.accountId ?? state.accounts[0]?.accountId ?? null
        if (id) { this.accountId = id; resolve(id) } else if (hideReason !== "wallet-navigation") { reject(new Error("Wallet connection was cancelled.")) }
      })
      modal.show()
    })
  }
  async signAndSendTransaction(call: ContractCall) {
    const selector = await getSelector(this.network)
    const wallet = await selector.wallet()
    const outcome = await wallet.signAndSendTransaction({
      receiverId: call.contractId,
      actions: [actionCreators.functionCall(call.methodName, call.args, BigInt(call.gas ?? "100000000000000"), BigInt(call.deposit ?? "0"))],
    })
    return { transactionHash: txHash(outcome) }
  }
  async signOut() {
    try { const selector = await getSelector(this.network); const wallet = await selector.wallet(); await wallet.signOut() } catch { /* ignore */ }
    this.accountId = null
  }
}

export async function connectWalletProvider(network: NearNetwork = "testnet"): Promise<WalletProvider> {
  const selector = await getSelector(network)
  const state = selector.store.getState()
  const id = state.accounts.find((a) => a.active)?.accountId ?? state.accounts[0]?.accountId ?? null
  return new SelectorWalletProvider(network, id)
}

// Legacy names still imported by lib/agent-engine.ts (whose functions nothing calls). They refuse
// rather than pretend: mandates are set on the escrow contract by its owner, and Intents are not built.
export type IntentRoute = { intentHash: string }
export const NEAR_RPC_URLS: Record<NearNetwork, string> = { mainnet: "https://rpc.mainnet.fastnear.com", testnet: "https://test.rpc.fastnear.com" }
export async function revokeMandateAccessKey(...args: unknown[]): Promise<{ transactionHash: string }> {
  void args
  throw new Error("Revoke the operator mandate on the escrow contract (revoke_mandate) from the owner's wallet.")
}
export async function routeStablecoinSettlement(...args: unknown[]): Promise<IntentRoute> {
  void args
  throw new Error("NEAR Intents settlement is not built; NEAR Intents has no testnet.")
}
