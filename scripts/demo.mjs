/**
 * Runs Mesh with no API keys: a fresh demo database, a demo operator, and a local stub in place of
 * Gemini (tests/fake-provider.mjs). The stub's replies are canned; it exists so reviewers can check
 * the real server path (auth, streaming, tools, approvals, policy, audit) without a provider key.
 *
 *   npm run demo        then open http://localhost:3000 and sign in as below.
 */
import { spawn, spawnSync } from "node:child_process"

export const DEMO_EMAIL = "judge@mesh.local"
export const DEMO_PASSWORD = "mesh-demo-password"

const env = {
  ...process.env,
  DATABASE_URL: "file:./data/demo.db",
  MESH_OPERATOR_EMAIL: DEMO_EMAIL,
  MESH_OPERATOR_PASSWORD: DEMO_PASSWORD,
  MESH_AI_PROVIDER: "google",
  MESH_AI_MODEL: "demo-stub",
  GEMINI_API_KEY: "demo-no-key",
  MESH_AI_BASE_URL: "http://localhost:3101/v1beta",
  MESH_AI_MAX_RETRIES: "0",
  MESH_SEARCH_BASE_URL: "http://localhost:3101",
  MESH_SEARCH_API_KEY: "test-key",
}
const shell = process.platform === "win32"

const setup = spawnSync("bun", ["scripts/db-setup.ts", "--reset"], { env, stdio: "inherit", shell })
if (setup.status !== 0) {
  console.error("Database setup failed. Is Bun installed? See README > Run it.")
  process.exit(setup.status ?? 1)
}

const children = [
  spawn(process.execPath, ["tests/fake-provider.mjs"], { env, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", "3000"], { env, stdio: "inherit" }),
]
console.log(`\nMesh demo: http://localhost:3000  sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n`)

const stop = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
for (const child of children) child.on("exit", (code) => { if (code) stop() })
