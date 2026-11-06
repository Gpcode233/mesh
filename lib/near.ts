export type NearNetwork = "mainnet" | "testnet"

export type ContractCall = {
  contractId: string
  methodName: string
  args: Record<string, unknown>
  gas?: string
  deposit?: string
}

export type MandateAccessKey = {
  publicKey: string
  allowanceYocto: string
  receiverId: string
  methodNames: string[]
  expiresAt: number
}

export type WalletProvider = {
  readonly network: NearNetwork
  readonly accountId: string | null
  connect(): Promise<string>
  signAndSendTransaction(call: ContractCall): Promise<{ transactionHash: string }>
  signOut(): Promise<void>
}

type InjectedNearWallet = {
  accountId?: string
  signIn?: (options: { contractId: string; methodNames?: string[] }) => Promise<void>
  signOut?: () => Promise<void>
  requestSignTransactions?: (transactions: unknown[]) => Promise<unknown>
}

export type IntentRoute = {
  intentHash: string
  sourceChain: string
  destinationChain: string
  asset: string
  amount: string
  status: "quoted" | "submitted" | "settled"
  createdAt: number
}

export const NEAR_RPC_URLS: Record<NearNetwork, string> = {
  mainnet: "https://rpc.mainnet.near.org",
  testnet: "https://rpc.testnet.near.org",
}

const encoder = new TextEncoder()

function hashLabel(value: string) {
  let hash = 2166136261
  for (const byte of encoder.encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash).toString(16).padStart(8, "0")
}

function createTransactionHash(call: ContractCall) {
  return `mesh-${hashLabel(JSON.stringify(call))}-${Date.now().toString(36)}`
}

export class MockWalletProvider implements WalletProvider {
  readonly network: NearNetwork
  accountId: string | null

  constructor(network: NearNetwork = "testnet", accountId = "mesh-demo.testnet") {
    this.network = network
    this.accountId = accountId
  }

  async connect() {
    this.accountId ??= `mesh-demo.${this.network}`
    return this.accountId
  }

  async signAndSendTransaction(call: ContractCall) {
    if (!this.accountId) {
      throw new Error("Connect a NEAR wallet before signing a transaction.")
    }
    return { transactionHash: createTransactionHash(call) }
  }

  async signOut() {
    this.accountId = null
  }
}

export class BrowserWalletProvider implements WalletProvider {
  readonly network: NearNetwork
  private readonly wallet: InjectedNearWallet
  accountId: string | null

  constructor(network: NearNetwork, wallet: InjectedNearWallet) {
    this.network = network
    this.wallet = wallet
    this.accountId = wallet.accountId ?? null
  }

  async connect() {
    if (!this.wallet.signIn) {
      throw new Error("The injected NEAR wallet does not support sign-in.")
    }
    await this.wallet.signIn({ contractId: "mandate.mesh.near" })
    this.accountId = this.wallet.accountId ?? null
    if (!this.accountId) throw new Error("NEAR wallet sign-in did not return an account.")
    return this.accountId
  }

  async signAndSendTransaction(call: ContractCall) {
    if (!this.wallet.requestSignTransactions) {
      throw new Error("The injected NEAR wallet cannot sign transactions.")
    }
    const result = await this.wallet.requestSignTransactions([{
      receiverId: call.contractId,
      actions: [{
        type: "FunctionCall",
        params: {
          methodName: call.methodName,
          args: call.args,
          gas: call.gas ?? "100000000000000",
          deposit: call.deposit ?? "0",
        },
      }],
    }])
    const transactionHash = typeof result === "object" && result !== null && "transactionHash" in result
      ? String(result.transactionHash)
      : createTransactionHash(call)
    return { transactionHash }
  }

  async signOut() {
    await this.wallet.signOut?.()
    this.accountId = null
  }
}

export async function connectWalletProvider(
  network: NearNetwork = "testnet"
): Promise<WalletProvider> {
  const injected = typeof window !== "undefined"
    ? (window as Window & { near?: InjectedNearWallet }).near
    : undefined
  if (injected) return new BrowserWalletProvider(network, injected)
  return new MockWalletProvider(network)
}

export async function issueMandateAccessKey(
  wallet: WalletProvider,
  input: {
    publicKey: string
    dailyCapNear: number
    receiverId: string
    methodNames: string[]
    durationDays?: number
    mandateContractId?: string
  }
) {
  if (input.dailyCapNear <= 0 || !Number.isFinite(input.dailyCapNear)) {
    throw new Error("The daily spending cap must be greater than zero.")
  }
  if (input.methodNames.length === 0) {
    throw new Error("At least one contract method must be allow-listed.")
  }

  const mandate: MandateAccessKey = {
    publicKey: input.publicKey,
    allowanceYocto: BigInt(Math.round(input.dailyCapNear * 1e24)).toString(),
    receiverId: input.receiverId,
    methodNames: input.methodNames,
    expiresAt: Date.now() + (input.durationDays ?? 30) * 86_400_000,
  }
  return wallet.signAndSendTransaction({
    contractId: input.mandateContractId ?? "mandate.mesh.near",
    methodName: "issue_access_key",
    args: mandate,
    gas: "100000000000000",
  })
}

export async function revokeMandateAccessKey(
  wallet: WalletProvider,
  publicKey: string,
  mandateContractId = "mandate.mesh.near"
) {
  if (!publicKey.trim()) {
    throw new Error("A public key is required to revoke a mandate.")
  }
  return wallet.signAndSendTransaction({
    contractId: mandateContractId,
    methodName: "revoke_access_key",
    args: { public_key: publicKey },
    gas: "50000000000000",
  })
}

export async function revokeAllAgentKeys(
  wallet: WalletProvider,
  mandateContractId = "mandate.mesh.near"
) {
  return wallet.signAndSendTransaction({
    contractId: mandateContractId,
    methodName: "freeze_agent_permissions",
    args: { reason: "operator_emergency_kill_switch" },
    gas: "100000000000000",
  })
}

export async function routeStablecoinSettlement(input: {
  sourceChain: string
  destinationChain: string
  asset: string
  amount: string
  recipient: string
  mode?: "quote" | "submit"
  intentsEndpoint?: string
  fetchImpl?: typeof fetch
}): Promise<IntentRoute> {
  if (!input.amount || Number(input.amount) <= 0) {
    throw new Error("Settlement amount must be greater than zero.")
  }

  const route: IntentRoute = {
    intentHash: `intent-${hashLabel(
      `${input.sourceChain}:${input.destinationChain}:${input.asset}:${input.amount}:${input.recipient}`
    )}`,
    sourceChain: input.sourceChain,
    destinationChain: input.destinationChain,
    asset: input.asset,
    amount: input.amount,
    status: input.mode === "submit" ? "submitted" : "quoted",
    createdAt: Date.now(),
  }

  if (input.intentsEndpoint && input.fetchImpl) {
    const response = await input.fetchImpl(input.intentsEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, intentHash: route.intentHash }),
    })
    if (!response.ok) {
      throw new Error(`NEAR Intents routing failed with HTTP ${response.status}.`)
    }
  }

  return route
}

export function createChainSignaturePayload(input: {
  intentHash: string
  destinationChain: string
  recipient: string
  amount: string
}) {
  return {
    domain: "mesh.chain-signatures",
    intentHash: input.intentHash,
    destinationChain: input.destinationChain,
    recipient: input.recipient,
    amount: input.amount,
    nonce: `${Date.now()}-${hashLabel(input.intentHash)}`,
  }
}
