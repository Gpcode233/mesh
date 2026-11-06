import { expect, test } from "@playwright/test"
import { TEST_OPERATOR, TEST_VIEWER } from "./fixtures"

test.use({ storageState: { cookies: [], origins: [] } })

const chatBody = { agent: "scout", channel: "direct", content: "hello", clientTurnId: "auth-test-turn-1" }

test("console pages redirect to sign-in when signed out", async ({ page }) => {
  for (const path of ["/", "/overview", "/orders/RFQ-1042", "/audit"]) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
  }
})

test("APIs refuse anonymous callers", async ({ request }) => {
  expect((await request.post("/api/agent-chat", { data: chatBody })).status()).toBe(401)
  expect((await request.get("/api/conversations")).status()).toBe(401)
  expect((await request.get("/api/audit")).status()).toBe(401)
})

test("wrong password is rejected with a generic message", async ({ page }) => {
  await page.goto("/login")
  await page.getByLabel("Email").fill(TEST_OPERATOR.email)
  await page.getByLabel("Password").fill("definitely-wrong-password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect" })).toHaveText("Incorrect email or password.")
  await expect(page).toHaveURL(/\/login$/)
})

test("sign-in attempts are rate limited", async ({ request }) => {
  const data = { email: "nobody@test.local", password: "wrong-password" }
  for (let attempt = 0; attempt < 10; attempt++) expect((await request.post("/api/auth/login", { data })).status()).toBe(401)
  const blocked = await request.post("/api/auth/login", { data })
  expect(blocked.status()).toBe(429)
  expect(blocked.headers()["retry-after"]).toBeTruthy()
})

test("sign out invalidates the session on the server", async ({ page, context }) => {
  await page.goto("/login")
  await page.getByLabel("Email").fill(TEST_OPERATOR.email)
  await page.getByLabel("Password").fill(TEST_OPERATOR.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("/")
  const cookie = (await context.cookies()).find((entry) => entry.name === "mesh_session")!
  expect(cookie.httpOnly).toBe(true)
  expect(cookie.sameSite).toBe("Lax")

  await page.getByRole("button", { name: "Sign out" }).first().click()
  await page.waitForURL(/\/login$/)

  // Replaying the old cookie must fail: the session row is gone, not just the browser cookie.
  const replay = await page.request.get("/api/conversations", { headers: { cookie: `mesh_session=${cookie.value}` } })
  expect(replay.status()).toBe(401)
})

test("a viewer cannot message agents and cannot read another user's conversations", async ({ request }) => {
  expect((await request.post("/api/auth/login", { data: TEST_VIEWER })).status()).toBe(200)
  expect((await request.post("/api/agent-chat", { data: chatBody })).status()).toBe(403)
  const { messages } = await (await request.get("/api/conversations")).json()
  expect(messages).toEqual([])
})
