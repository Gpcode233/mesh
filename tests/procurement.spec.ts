import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test"
import { TEST_VIEWER } from "./fixtures"

const token = () => `tok-${Math.random().toString(36).slice(2, 10)}`
const turnId = () => `turn-${Math.random().toString(36).slice(2, 12)}`
const rfqBody = (resource: string, maxBudget = 5000) => ({ resource, quantity: 10, unit: "t", maxBudget, deadline: "2099-01-01", destination: "Hamburg" })

async function createRfq(request: APIRequestContext, resource: string, maxBudget?: number) {
  const response = await request.post("/api/rfqs", { data: rfqBody(resource, maxBudget) })
  expect(response.status()).toBe(201)
  return (await response.json()).id as string
}

async function addBid(request: APIRequestContext, rfqId: string, supplier: string, amount: number) {
  const response = await request.post(`/api/rfqs/${rfqId}/bids`, { data: { supplier, amount } })
  expect(response.status()).toBe(201)
  return (await response.json()).id as string
}

async function proposeInChat(page: Page, tok: string) {
  await page.goto("/")
  await page.getByPlaceholder("Message Head agent…").fill(`PROPOSE_RFQ ${tok}`)
  await page.getByRole("button", { name: /Send/ }).click()
  const card = page.getByTestId("approval-card").filter({ hasText: tok })
  await expect(card).toBeVisible()
  return card
}

const policy = {
  dailySpendLimit: 50000, perOrderLimit: 20000, approvalThreshold: 10000, requiredBidCount: 3,
  approvedRegions: ["EU"], requiredDocuments: ["ISO 9001"], approvedAssets: ["USDC"], approvedChains: ["NEAR"],
  agentKeyExpiryHours: 24, freezeBehavior: "Revoke all keys",
}

test("a chat proposal creates nothing until the operator approves it", async ({ page }) => {
  const tok = token()
  const card = await proposeInChat(page, tok)

  await page.goto("/orders")
  await expect(page.getByRole("link", { name: new RegExp(tok) })).toHaveCount(0)

  await page.goto("/")
  await card.getByRole("button", { name: /Approve/ }).click()
  await card.getByRole("link", { name: /Open RFQ-/ }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Steel ${tok}`)

  await page.goto("/orders")
  await expect(page.getByRole("link", { name: new RegExp(tok) })).toBeVisible()
})

test("a decided approval stays decided after reload and cannot be decided again", async ({ page }) => {
  const tok = token()
  const card = await proposeInChat(page, tok)
  await card.getByRole("button", { name: /Approve/ }).click()
  await expect(card.getByText("approved")).toBeVisible()

  await page.reload()
  const reloaded = page.getByTestId("approval-card").filter({ hasText: tok })
  await expect(reloaded.getByText("approved")).toBeVisible()
  await expect(reloaded.getByRole("button", { name: /Approve/ })).toHaveCount(0)

  const { messages } = await (await page.request.get("/api/conversations")).json() as { messages: Array<{ approval: { id: string; draft: { resource: string } } | null }> }
  const id = messages.find((message) => message.approval?.draft.resource.includes(tok))!.approval!.id
  for (const decision of ["approve", "reject"]) {
    expect((await page.request.post(`/api/approvals/${id}`, { data: { decision } })).status()).toBe(409)
  }
})

test("rejecting a proposal creates no RFQ", async ({ page }) => {
  const tok = token()
  const card = await proposeInChat(page, tok)
  await card.getByRole("button", { name: "Reject" }).click()
  await expect(card.getByText("rejected")).toBeVisible()
  await page.goto("/orders")
  await expect(page.getByRole("link", { name: new RegExp(tok) })).toHaveCount(0)
})

test("invalid tool arguments from the model produce no card and say so", async ({ page }) => {
  const tok = token()
  await page.goto("/")
  await page.getByPlaceholder("Message Head agent…").fill(`PROPOSE_BAD ${tok}`)
  await page.getByRole("button", { name: /Send/ }).click()
  await expect(page.getByText("I couldn't draft that RFQ: Quantity must be a number greater than zero. Nothing was created.").last()).toBeVisible()
  await expect(page.getByTestId("approval-card").filter({ hasText: tok })).toHaveCount(0)
})

test("the tool is offered only to the Head Agent in its direct thread", async ({ request }) => {
  const tok = token()
  const asScout = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: `PROPOSE_RFQ ${tok}`, clientTurnId: turnId() } })).json()
  expect(asScout.approval).toBeNull()
  const inGroup = await (await request.post("/api/agent-chat", { data: { agent: "head", channel: "group", content: `PROPOSE_RFQ ${tok}`, clientTurnId: turnId() } })).json()
  expect(inGroup.approval).toBeNull()
})

test("retrying a turn does not draft a second approval", async ({ request }) => {
  const data = { agent: "head", channel: "direct", content: `PROPOSE_RFQ ${token()}`, clientTurnId: turnId() }
  const first = await (await request.post("/api/agent-chat", { data })).json()
  const second = await (await request.post("/api/agent-chat", { data })).json()
  expect(first.approval.id).toBeTruthy()
  expect(second.approval.id).toBe(first.approval.id)
})

test("signed-out callers and viewers cannot decide approvals or change procurement data", async ({ request, baseURL }) => {
  const { approval } = await (await request.post("/api/agent-chat", { data: { agent: "head", channel: "direct", content: `PROPOSE_RFQ ${token()}`, clientTurnId: turnId() } })).json()
  const rfqId = await createRfq(request, `Guarded ${token()}`)
  const bidId = await addBid(request, rfqId, `Guard Supplier ${token()}`, 100)

  const anonymous = await apiRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  expect((await anonymous.post(`/api/approvals/${approval.id}`, { data: { decision: "approve" } })).status()).toBe(401)
  expect((await anonymous.post("/api/rfqs", { data: rfqBody("Nope") })).status()).toBe(401)
  await anonymous.dispose()

  const viewer = await apiRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  expect((await viewer.post("/api/auth/login", { data: TEST_VIEWER })).status()).toBe(200)
  expect((await viewer.post(`/api/approvals/${approval.id}`, { data: { decision: "approve" } })).status()).toBe(403)
  expect((await viewer.post("/api/rfqs", { data: rfqBody("Nope") })).status()).toBe(403)
  expect((await viewer.post(`/api/rfqs/${rfqId}/bids`, { data: { supplier: "Nope", amount: 1 } })).status()).toBe(403)
  expect((await viewer.post(`/api/rfqs/${rfqId}/select`, { data: { bidId } })).status()).toBe(403)
  expect((await viewer.put("/api/policy", { data: policy })).status()).toBe(403)
  await viewer.dispose()
})

test("invalid RFQs and bids are rejected", async ({ request }) => {
  for (const data of [
    { ...rfqBody("x"), resource: " " }, { ...rfqBody("x"), quantity: 0 }, { ...rfqBody("x"), quantity: "many" },
    { ...rfqBody("x"), maxBudget: -1 }, { ...rfqBody("x"), deadline: "soon" }, { ...rfqBody("x"), deadline: "2020-01-01" },
    { ...rfqBody("x"), deadline: "2099-02-31" }, { ...rfqBody("x"), destination: "" }, { ...rfqBody("x"), unit: "" },
  ]) {
    expect((await request.post("/api/rfqs", { data })).status(), JSON.stringify(data)).toBe(400)
  }
  const rfqId = await createRfq(request, `Validation ${token()}`)
  for (const data of [{ supplier: "", amount: 1 }, { supplier: "A", amount: 0 }, { supplier: "A", amount: 1, leadTimeDays: 1.5 }]) {
    expect((await request.post(`/api/rfqs/${rfqId}/bids`, { data })).status(), JSON.stringify(data)).toBe(400)
  }
  expect((await request.post("/api/rfqs/does-not-exist/bids", { data: { supplier: "A", amount: 1 } })).status()).toBe(404)
})

test("record bids and select a supplier in the UI, with policy enforced", async ({ page }) => {
  const tok = token()
  const rfqId = await createRfq(page.request, `Copper ${tok}`)
  await page.goto(`/orders/${rfqId}`)
  await expect(page.getByText("Bids received")).toBeVisible()
  await expect(page.getByText("Not built yet").first()).toBeVisible()

  const record = async (supplier: string, amount: string) => {
    await page.getByLabel("Supplier").fill(supplier)
    await page.getByLabel("Amount (USD)").fill(amount)
    await page.getByRole("button", { name: "Record bid" }).click()
    await expect(page.getByTestId("bid-row").filter({ hasText: supplier })).toBeVisible()
  }
  await record(`Alpha ${tok}`, "4000")

  // Too few bids: the server refuses and the page says why.
  await page.getByTestId("bid-row").first().getByRole("button", { name: "Select" }).click()
  await page.getByRole("button", { name: /^Confirm/ }).click()
  await expect(page.locator("p[role=alert]")).toHaveText("Policy requires 3 bids; this RFQ has 1.")

  await record(`Beta ${tok}`, "4500")
  await record(`Gamma ${tok}`, "9000")
  await expect(page.getByTestId("bid-row").filter({ hasText: `Gamma ${tok}` }).getByText("Over budget")).toBeVisible()

  // Over the RFQ budget: refused even though enough bids exist.
  await page.getByTestId("bid-row").filter({ hasText: `Gamma ${tok}` }).getByRole("button", { name: "Select" }).click()
  await page.getByRole("button", { name: /^Confirm/ }).click()
  await expect(page.locator("p[role=alert]")).toContainText("over the RFQ budget")

  const beta = page.getByTestId("bid-row").filter({ hasText: `Beta ${tok}` })
  await beta.getByRole("button", { name: "Select" }).click()
  await page.getByRole("button", { name: /^Confirm/ }).click()
  await expect(beta.getByText("Selected")).toBeVisible()
  await expect(page.getByText("Awarded")).toBeVisible()
  await expect(page.getByRole("button", { name: "Record bid" })).toHaveCount(0)

  await page.goto("/suppliers")
  await expect(page.getByText(`Beta ${tok}`)).toBeVisible()
  await page.goto("/orders")
  await expect(page.getByRole("link", { name: new RegExp(`Copper ${tok}`) })).toContainText(`Beta ${tok}`)
})

test("an awarded RFQ cannot be re-awarded or take new bids, and duplicate suppliers are refused", async ({ request }) => {
  const tok = token()
  const rfqId = await createRfq(request, `Award ${tok}`)
  const first = await addBid(request, rfqId, `One ${tok}`, 100)
  const second = await addBid(request, rfqId, `Two ${tok}`, 200)
  await addBid(request, rfqId, `Three ${tok}`, 300)

  // Bid count means distinct suppliers.
  expect((await request.post(`/api/rfqs/${rfqId}/bids`, { data: { supplier: `One ${tok}`, amount: 90 } })).status()).toBe(409)

  // Racing selections: exactly one wins.
  const raced = await Promise.all([first, second].map((bidId) => request.post(`/api/rfqs/${rfqId}/select`, { data: { bidId } })))
  expect(raced.map((response) => response.status()).sort()).toEqual([201, 409])

  expect((await request.post(`/api/rfqs/${rfqId}/select`, { data: { bidId: second } })).status()).toBe(409)
  expect((await request.post(`/api/rfqs/${rfqId}/bids`, { data: { supplier: `Late ${tok}`, amount: 50 } })).status()).toBe(409)
})

test("racing approvals create exactly one RFQ", async ({ request }) => {
  const tok = token()
  const { approval } = await (await request.post("/api/agent-chat", { data: { agent: "head", channel: "direct", content: `PROPOSE_RFQ ${tok}`, clientTurnId: turnId() } })).json()
  const raced = await Promise.all(["approve", "approve", "reject"].map((decision) => request.post(`/api/approvals/${approval.id}`, { data: { decision } })))
  expect(raced.filter((response) => response.ok())).toHaveLength(1)
  expect(raced.filter((response) => response.status() === 409)).toHaveLength(2)
})

test("policy edits persist, are validated, and change what can be approved", async ({ page, request }) => {
  const tok = token()
  try {
    // Per-order limit.
    const rfqId = await createRfq(request, `Large ${tok}`, 30000)
    const bidId = await addBid(request, rfqId, `Big ${tok}`, 25000)
    await addBid(request, rfqId, `Bigger ${tok}`, 26000)
    await addBid(request, rfqId, `Biggest ${tok}`, 27000)
    const overLimit = await request.post(`/api/rfqs/${rfqId}/select`, { data: { bidId } })
    expect(overLimit.status()).toBe(422)
    expect((await overLimit.json()).error).toContain("per-order limit")

    // Inconsistent limits are refused through the form.
    await page.goto("/policies")
    await page.getByLabel("Owner approval threshold (USD)").fill("999999")
    await page.getByRole("button", { name: "Save policy" }).click()
    await expect(page.getByRole("alert").filter({ hasText: "Limits must satisfy" })).toBeVisible()

    // Saved limits persist across a reload.
    await page.getByLabel("Owner approval threshold (USD)").fill("10000")
    await page.getByLabel("Required bid count").fill("1")
    await page.getByRole("button", { name: "Save policy" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Policy saved." })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel("Required bid count")).toHaveValue("1")

    // Daily limit: small enough that today's commitment plus this bid exceeds it.
    expect((await request.put("/api/policy", { data: { ...policy, requiredBidCount: 1, dailySpendLimit: 50, perOrderLimit: 50, approvalThreshold: 50 } })).status()).toBe(200)
    const dailyRfq = await createRfq(request, `Daily ${tok}`)
    const dailyBid = await addBid(request, dailyRfq, `Daily Supplier ${tok}`, 40)
    const overDaily = await request.post(`/api/rfqs/${dailyRfq}/select`, { data: { bidId: dailyBid } })
    expect(overDaily.status()).toBe(422)
    expect((await overDaily.json()).error).toContain("daily limit")
  } finally {
    expect((await request.put("/api/policy", { data: policy })).status()).toBe(200)
  }
})

test("procurement decisions reach the audit log", async ({ page }) => {
  await page.goto("/audit")
  const recorded = page.getByTestId("recorded-events")
  for (const action of ["approval.requested", "approval.rejected", "agent_tool.called", "agent_tool.rejected", "rfq.created", "bid.recorded", "order.approved", "order.blocked", "policy.updated"]) {
    await expect(recorded).toContainText(action)
  }
})
