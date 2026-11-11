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
  // Generous: the whole stack runs on the developer machine, and small machines are slow under load.
  timeout: 90_000,
  expect: { timeout: 20_000 },
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
      // MESH_SKIP_BUILD=1 reuses an existing `npm run build` (the build alone can take minutes on small machines).
      command: `bun scripts/db-setup.ts --reset && ${process.env.MESH_SKIP_BUILD ? "" : "npm run build && "}node node_modules/next/dist/bin/next start -p ${port}`,
      url: `http://localhost:${port}/login`,
      reuseExistingServer: false,
      timeout: 600_000,
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
          MESH_AI_BASE_URL: "http://localhost:3101/v1beta",
          MESH_AI_MAX_RETRIES: "0",
          MESH_SEARCH_BASE_URL: "http://localhost:3101",
          MESH_SEARCH_API_KEY: "test-key",
          // Tests never touch a real chain: an empty value overrides .env and disables the escrow.
          MESH_ESCROW_CONTRACT_ID: "",
          MESH_NEAR_OPERATOR_PRIVATE_KEY: "",
        }),
      },
    },
  ],
})
