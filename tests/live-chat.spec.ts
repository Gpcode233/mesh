import { expect, test } from "@playwright/test"

// Calls the real AI provider through the real UI. Skipped unless MESH_LIVE=1:
//   MESH_LIVE=1 npx playwright test tests/live-chat.spec.ts --workers=1
test.skip(!process.env.MESH_LIVE, "Set MESH_LIVE=1 to call the real AI provider")
test.setTimeout(180_000)

const shots = process.env.MESH_SHOTS ?? "test-results"

test("direct chat: Compliance answers a real prompt", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /^Compliance/ }).first().click()
  await page.getByPlaceholder("Message Compliance…").fill("Which documents should I request from a new lithium carbonate supplier? Answer in three bullets.")
  await page.getByRole("button", { name: /Send/ }).click()
  const reply = page.locator("div.whitespace-pre-wrap").filter({ hasText: /^(Compliance|Provider error)/ }).last()
  await expect(reply).toBeVisible({ timeout: 90_000 })
  console.log("COMPLIANCE:", await reply.innerText())
  await page.screenshot({ path: `${shots}/live-direct.png`, fullPage: true })
  await expect(page.getByText("Provider error")).toHaveCount(0)
})

test("group chat: all six agents answer a real prompt", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /Group/ }).click()
  await page.getByPlaceholder("Message all agents…").fill("We need 500kg of lithium carbonate delivered to Rotterdam by Dec 1. In two sentences, what do you check first?")
  await page.getByRole("button", { name: /Send to all/ }).click()
  await expect(page.getByText("thinking…")).toHaveCount(0, { timeout: 150_000 })
  const bubbles = page.locator("div.whitespace-pre-wrap")
  for (const text of await bubbles.allInnerTexts()) console.log("GROUP:", text.replace(/\s+/g, " "))
  await page.screenshot({ path: `${shots}/live-group.png`, fullPage: true })
  await expect(bubbles).toHaveCount(7)
  await expect(page.getByText(/· error/)).toHaveCount(0)
})

test("Head Agent: a real model drafts an RFQ, asks for missing details, and creates nothing until approved", async ({ page }) => {
  await page.goto("/")
  const send = async (text: string) => {
    await page.getByPlaceholder("Message Head agent…").fill(text)
    await page.getByRole("button", { name: /Send/ }).click()
    await expect(page.getByRole("button", { name: "Thinking" })).toHaveCount(0, { timeout: 90_000 })
  }

  // Missing budget, deadline and destination: it should ask rather than draft.
  await send("I want to buy lithium carbonate.")
  await expect(page.getByTestId("approval-card")).toHaveCount(0)
  console.log("ASK:", (await page.locator("div.whitespace-pre-wrap").last().innerText()).replace(/\s+/g, " "))

  await send("500 kg, maximum budget $20,000 USD, delivered to Rotterdam by 2099-12-01.")
  const card = page.getByTestId("approval-card")
  await expect(card).toBeVisible()
  console.log("CARD:", (await card.innerText()).replace(/\s+/g, " "))
  await expect(card).toContainText("Rotterdam")
  await expect(card).toContainText("$20,000")
  await page.screenshot({ path: `${shots}/live-rfq.png`, fullPage: true })

  await card.getByRole("button", { name: /Approve/ }).click()
  await card.getByRole("link", { name: /Open RFQ-/ }).click()
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/lithium carbonate/i)
})

// Real model and, when MESH_SEARCH_API_KEY is set in .env, real web search.
test.describe("Scout with a real model", () => {
  const ask = async (page: import("@playwright/test").Page, text: string) => {
    await page.getByPlaceholder("Message Scout…").fill(text)
    await page.getByRole("button", { name: /Send/ }).click()
    await expect(page.getByRole("button", { name: "Thinking" })).toHaveCount(0, { timeout: 120_000 })
    const reply = page.locator("div.whitespace-pre-wrap").last()
    console.log("SCOUT:", (await reply.innerText()).replace(/\s+/g, " "))
    return reply
  }

  test("searches the web and cites what it found", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: /^Scout/ }).first().click()
    const reply = await ask(page, "Find ISO 9001 certified steel bolt manufacturers in Germany. List up to three with their source links.")
    await expect(page.getByText("Provider error")).toHaveCount(0)
    const steps = page.getByTestId("tool-steps").last()
    await steps.getByRole("button").click()
    await expect(steps).toContainText("Search the web")
    await expect(reply).toContainText("http")
    await expect(page.getByTestId("approval-card")).toHaveCount(0)

    // A follow-up can propose from the results stored on the previous reply, without searching again.
    await ask(page, "Propose the first one for our supplier network.")
    const card = page.getByTestId("approval-card").last()
    await expect(card).toBeVisible()
    console.log("FOLLOW-UP CARD:", (await card.innerText()).replace(/\s+/g, " "))
    await page.screenshot({ path: `${shots}/live-scout-followup.png`, fullPage: true })
  })

  test("searches and proposes one supplier in a single request, and nothing is saved before approval", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: /^Scout/ }).first().click()
    await ask(page, "Search for an ISO 9001 certified steel bolt manufacturer in Germany and propose the best match for our supplier network.")
    await expect(page.getByText("Provider error")).toHaveCount(0)
    const card = page.getByTestId("approval-card").last()
    await expect(card).toBeVisible()
    console.log("CARD:", (await card.innerText()).replace(/\s+/g, " "))
    const href = await card.getByRole("link").first().getAttribute("href")
    console.log("SOURCE:", href)
    expect(href).toMatch(/^https?:\/\//)
    await page.screenshot({ path: `${shots}/live-scout-card.png`, fullPage: true })

    const name = (/Add supplier: (.+)/.exec(await card.innerText())?.[1] ?? "").split("\n")[0].trim()
    await page.goto("/suppliers")
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0)
  })
})
