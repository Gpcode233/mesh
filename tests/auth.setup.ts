import { createClient } from "@libsql/client"
import { test as setup } from "@playwright/test"
import { hashPassword } from "../lib/password"
import { TEST_DATABASE_URL, TEST_OPERATOR, TEST_VIEWER } from "./fixtures"

setup("sign in operator and create a viewer", async ({ page }) => {
  const client = createClient({ url: TEST_DATABASE_URL })
  const org = await client.execute("SELECT id FROM organizations LIMIT 1")
  const userId = crypto.randomUUID()
  await client.execute({
    sql: "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, 'Viewer', ?, ?)",
    args: [userId, TEST_VIEWER.email, await hashPassword(TEST_VIEWER.password), Date.now()],
  })
  await client.execute({
    sql: "INSERT INTO memberships (id, org_id, user_id, role, created_at) VALUES (?, ?, ?, 'viewer', ?)",
    args: [crypto.randomUUID(), String(org.rows[0].id), userId, Date.now()],
  })
  client.close()

  await page.goto("/login")
  await page.getByLabel("Email").fill(TEST_OPERATOR.email)
  await page.getByLabel("Password").fill(TEST_OPERATOR.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL("/")
  await page.context().storageState({ path: "playwright/.auth/operator.json" })
})
