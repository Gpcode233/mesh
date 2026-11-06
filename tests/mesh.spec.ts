import { expect, test } from "@playwright/test"

// The chat runs the real server path (auth, database, audit) against tests/fake-provider.mjs.
const token = () => `tok-${Math.random().toString(36).slice(2, 10)}`

test("default route is the Head Agent chat", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /Ask Mesh/ })).toBeVisible()
  await expect(page.getByPlaceholder("Message Head agent…")).toBeVisible()
})

for (const [path, heading] of [
  ["/overview", /Procurement that/],
  ["/orders", /Every RFQ/],
  ["/agents", /Who can act/],
  ["/policies", /Set the rules/],
  ["/suppliers", /Know who/],
  ["/settlements", /Move value/],
  ["/audit", /Everything/],
] as const) {
  test(`route ${path} renders`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading)
  })
}

test("can chat with every agent directly, each with its own thread", async ({ page }) => {
  await page.goto("/")
  const tokens: Record<string, string> = {}
  for (const [label, id] of [["Head agent", "head"], ["Scout", "scout"], ["Compliance", "compliance"], ["Negotiator", "negotiator"], ["Settlement", "settlement"], ["Guard", "guard"]]) {
    tokens[id] = token()
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click()
    await page.getByPlaceholder(`Message ${label}…`).fill(`hello ${tokens[id]}`)
    await page.getByRole("button", { name: /Send/ }).click()
    await expect(page.getByText(`reply-from-${id} ${tokens[id]}`)).toBeVisible()
  }
  // Threads stay separate: Scout's thread must not contain Guard's reply.
  await page.getByRole("button", { name: /^Scout/ }).first().click()
  await expect(page.getByText(`reply-from-scout ${tokens.scout}`)).toBeVisible()
  await expect(page.getByText(`reply-from-guard ${tokens.guard}`)).toHaveCount(0)
})

test("agent markdown renders as formatting, not literal asterisks", async ({ page }) => {
  const tok = token()
  await page.goto("/")
  await page.getByPlaceholder("Message Head agent…").fill(`format ${tok}`)
  await page.getByRole("button", { name: /Send/ }).click()
  await expect(page.locator("strong", { hasText: `bold-${tok}` })).toBeVisible()
  await expect(page.getByText(`**bold-${tok}**`)).toHaveCount(0)
})

test("conversations survive a reload, and the agent keeps its history", async ({ page }) => {
  const [first, second] = [token(), token()]
  await page.goto("/")
  await page.getByRole("button", { name: /^Negotiator/ }).first().click()
  await page.getByPlaceholder("Message Negotiator…").fill(`first ${first}`)
  await page.getByRole("button", { name: /Send/ }).click()
  await expect(page.getByText(`reply-from-negotiator ${first}`)).toBeVisible()

  await page.reload()
  await page.getByRole("button", { name: /^Negotiator/ }).first().click()
  await expect(page.getByText(`reply-from-negotiator ${first}`)).toBeVisible()

  // History is server-owned: the next call includes the earlier turns.
  await page.getByPlaceholder("Message Negotiator…").fill(`second ${second}`)
  await page.getByRole("button", { name: /Send/ }).click()
  await expect(page.getByText(new RegExp(`reply-from-negotiator ${second} turns=([3-9]|1[0-9])`))).toBeVisible()
})

test("group chat reaches all six agents and stores the user's message once", async ({ page }) => {
  const tok = token()
  await page.goto("/")
  await page.getByRole("button", { name: /Group/ }).click()
  await page.getByPlaceholder("Message all agents…").fill(`status check ${tok}`)
  await page.getByRole("button", { name: /Send to all/ }).click()
  const ids = ["head", "scout", "compliance", "negotiator", "settlement", "guard"]
  for (const id of ids) await expect(page.getByText(`reply-from-${id} ${tok}`)).toBeVisible()

  const { messages } = await (await page.request.get("/api/conversations")).json() as { messages: Array<{ author: string; content: string; channel: string }> }
  const turn = messages.filter((message) => message.channel === "group" && message.content.includes(tok))
  expect(turn.map((message) => message.author).sort()).toEqual([...ids, "user"].sort())

  await page.reload()
  await page.getByRole("button", { name: /Group/ }).click()
  for (const id of ids) await expect(page.getByText(`reply-from-${id} ${tok}`)).toBeVisible()
})

test("retrying a turn returns the stored reply without storing a duplicate", async ({ request }) => {
  const tok = token()
  const data = { agent: "guard", channel: "direct", content: `retry ${tok}`, clientTurnId: `retry-${tok}` }
  const first = await (await request.post("/api/agent-chat", { data })).json()
  const second = await (await request.post("/api/agent-chat", { data })).json()
  expect(second.content).toBe(first.content)
  const { messages } = await (await request.get("/api/conversations")).json() as { messages: Array<{ content: string }> }
  expect(messages.filter((message) => message.content.includes(tok))).toHaveLength(2)
})

test("invalid chat input is rejected", async ({ request }) => {
  const valid = { agent: "scout", channel: "direct", content: "hi", clientTurnId: "valid-turn-id" }
  for (const data of [{ ...valid, agent: "nope" }, { ...valid, channel: "x" }, { ...valid, content: "  " }, { ...valid, content: "x".repeat(4001) }, { ...valid, clientTurnId: "!" }]) {
    expect((await request.post("/api/agent-chat", { data })).status()).toBe(400)
  }
})

test("provider failure shows an explicit error, not fake success", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /^Scout/ }).first().click()
  await page.getByPlaceholder("Message Scout…").fill("FAIL_PROVIDER please")
  await page.getByRole("button", { name: /Send/ }).click()
  await expect(page.getByText("Provider error")).toBeVisible()
  await expect(page.getByText("AI provider returned 500.").first()).toBeVisible()
})

test("agent chats and failures reach the persistent audit log, without message content", async ({ page }) => {
  await page.goto("/audit")
  const recorded = page.getByTestId("recorded-events")
  await expect(recorded).toContainText("agent_chat.replied")
  await expect(recorded).toContainText("agent_chat.failed")
  await expect(recorded).toContainText("auth.login")
  const { events } = await (await page.request.get("/api/audit")).json()
  expect(JSON.stringify(events)).not.toContain("FAIL_PROVIDER")
})

test("order detail shows lifecycle timeline", async ({ page }) => {
  await page.goto("/orders/RFQ-1042")
  await expect(page.getByRole("heading", { name: "Lithium carbonate" })).toBeVisible()
  await expect(page.getByText("Intent submitted")).toBeVisible()
})

test("creating a purchase order adds it to orders", async ({ page }) => {
  await page.goto("/overview")
  await page.getByRole("button", { name: /New purchase order/ }).first().click()
  await page.getByLabel("Resource need").fill("Steel plate")
  await page.getByLabel("Quantity").fill("10")
  await page.getByLabel("Unit").fill("t")
  await page.getByLabel("Max budget (USDC)").fill("5000")
  await page.getByLabel("Deadline").fill("2026-12-01")
  await page.getByLabel("Destination").fill("Hamburg hub")
  await page.getByRole("button", { name: /Publish to agent network/ }).click()
  await page.getByRole("link", { name: "Orders", exact: true }).first().click()
  await expect(page.getByRole("link", { name: /Steel plate/ })).toBeVisible()
})
