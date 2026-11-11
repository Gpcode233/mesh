import { expect, test } from "@playwright/test"

// Scout's web search runs against the Tavily-shaped /search endpoint in tests/fake-provider.mjs.
const token = () => `tok-${Math.random().toString(36).slice(2, 10)}`
const turnId = () => `turn-${Math.random().toString(36).slice(2, 12)}`

test("Scout searches the web, and a supplier is saved only after the operator approves it", async ({ page }) => {
  const tok = token()
  await page.goto("/")
  await page.getByRole("button", { name: /^Scout/ }).first().click()
  await page.getByPlaceholder("Message Scout…").fill(`FIND_SUPPLIERS PROPOSE_FOUND ${tok}`)
  await page.getByRole("button", { name: /Send/ }).click()

  const card = page.getByTestId("approval-card").filter({ hasText: `Acme Fasteners ${tok}` })
  await expect(card).toBeVisible()
  await expect(card).toContainText("found by web search, not verified")
  await expect(card.getByRole("link", { name: new RegExp(`acme-${tok}\\.example`) })).toHaveAttribute("href", `https://acme-${tok}.example/bolts`)
  await expect(page.getByText(`I found Acme Fasteners ${tok} on the web`)).toBeVisible()

  // Nothing saved yet.
  await page.goto("/suppliers")
  await expect(page.getByText(`Acme Fasteners ${tok}`)).toHaveCount(0)

  await page.goto("/")
  await page.getByRole("button", { name: /^Scout/ }).first().click()
  await card.getByRole("button", { name: /Approve & add supplier/ }).click()
  await expect(card.getByText("approved")).toBeVisible()
  await card.getByRole("link", { name: "Open suppliers" }).click()
  await page.waitForURL("**/suppliers")
  await expect(page.getByRole("heading", { name: `Acme Fasteners ${tok}` })).toBeVisible()
  await expect(page.getByRole("link", { name: new RegExp(`Web source · acme-${tok}\\.example`) })).toBeVisible()

  const { events } = await (await page.request.get("/api/audit")).json() as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }
  expect(events.some((event) => event.action === "supplier.added" && event.metadata?.source === "discovery")).toBe(true)
  expect(events.some((event) => event.action === "agent_tool.called" && event.metadata?.tool === "search_web")).toBe(true)
})

test("search results are untrusted: unsafe links are dropped and the steps show what was found", async ({ request }) => {
  const tok = token()
  const reply = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: `FIND_SUPPLIERS ${tok}`, clientTurnId: turnId() } })).json()
  // The fake returns three results; the javascript: one never reaches the model.
  expect(reply.content).toBe("read-search_web total=2")
  expect(reply.approval).toBeNull()
  expect(reply.steps).toEqual([expect.objectContaining({ tool: "search_web", status: "done", detail: "2 found" })])
})

test("Scout cannot propose a supplier that its search did not return", async ({ request }) => {
  const tok = token()
  const reply = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: `FIND_SUPPLIERS PROPOSE_INVENTED ${tok}`, clientTurnId: turnId() } })).json()
  expect(reply.approval).toBeNull()
  expect(reply.content).toBe("I couldn't propose that supplier: The source URL is not one of the search results in this conversation. Nothing was saved.")

  const { events } = await (await request.get("/api/audit")).json() as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }
  expect(events.some((event) => event.action === "agent_tool.rejected" && event.metadata?.tool === "propose_supplier")).toBe(true)
})

test("a supplier can be proposed from a search in an earlier reply in the same thread", async ({ request }) => {
  const tok = token()
  // First turn: search only. Second turn: propose from those stored results without searching again.
  expect((await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: `FIND_SUPPLIERS ${tok}`, clientTurnId: turnId() } })).json()).content).toBe("read-search_web total=2")
  const later = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: `PROPOSE_EARLIER ${tok}`, clientTurnId: turnId() } })).json()
  expect(later.approval?.supplier).toEqual(expect.objectContaining({ sourceUrl: `https://acme-${tok}.example/bolts`, sourceTitle: `Acme Fasteners ${tok} - steel bolts` }))
  expect(later.steps).toEqual([expect.objectContaining({ tool: "propose_supplier", status: "done" })])
})

test("a supplier already in the network is not proposed twice, and a decided card stays decided", async ({ request }) => {
  const tok = token()
  const first = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: `FIND_SUPPLIERS PROPOSE_FOUND ${tok}`, clientTurnId: turnId() } })).json()
  const raced = await Promise.all(["approve", "approve"].map((decision) => request.post(`/api/approvals/${first.approval.id}`, { data: { decision } })))
  expect(raced.map((response) => response.status()).sort()).toEqual([200, 409])

  const again = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: `FIND_SUPPLIERS PROPOSE_FOUND ${tok}`, clientTurnId: turnId() } })).json()
  expect(again.approval).toBeNull()
  expect(again.content).toBe(`I couldn't propose that supplier: Acme Fasteners ${tok} is already in the supplier network. Nothing was saved.`)
})

test("only Scout, in its direct thread, can search the web", async ({ request }) => {
  const scout = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "direct", content: token(), clientTurnId: turnId() } })).json()
  expect(scout.content).toContain("tools=get_order,get_policy,list_orders,list_suppliers,propose_supplier,search_web")
  for (const agent of ["head", "compliance"]) {
    const other = await (await request.post("/api/agent-chat", { data: { agent, channel: "direct", content: `FIND_SUPPLIERS ${token()}`, clientTurnId: turnId() } })).json()
    expect(other.content).not.toContain("search_web")
    expect(other.steps).toEqual([])
  }
  const group = await (await request.post("/api/agent-chat", { data: { agent: "scout", channel: "group", content: `FIND_SUPPLIERS ${token()}`, clientTurnId: turnId() } })).json()
  expect(group.content).toContain("tools=none")
})
