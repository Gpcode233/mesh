import { defineConfig, devices } from "@playwright/test"
import { TEST_DATABASE_URL, TEST_OPERATOR } from "./tests/fixtures"

const port = 3100
const live = !!process.env.MESH_LIVE

export default defineConfig({
  testDir: "./tests",
  // One shared test database and operator, so tests run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/operator.json" },
    },
  ],
  webServer: [
    ...(live ? [] : [{ command: "node tests/fake-provider.mjs", port: 3101, reuseExistingServer: false }]),
    {
      command: `bun scripts/db-setup.ts --reset && npm run build && node node_modules/next/dist/bin/next start -p ${port}`,
      url: `http://localhost:${port}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        DATABASE_URL: TEST_DATABASE_URL,
        MESH_OPERATOR_EMAIL: TEST_OPERATOR.email,
        MESH_OPERATOR_PASSWORD: TEST_OPERATOR.password,
        MESH_CHAT_RATE_LIMIT: "1000",
        // Live runs use the real provider settings from .env.
        ...(live ? {} : {
          MESH_AI_PROVIDER: "google",
          MESH_AI_MODEL: "fake-model",
          GEMINI_API_KEY: "test-key",
          MESH_AI_BASE_URL: "http://localhost:3101/generate",
        }),
      },
    },
  ],
})
