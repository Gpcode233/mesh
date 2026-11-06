import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createClient } from "@libsql/client"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"
import * as schema from "@/lib/db/schema"

export const DEFAULT_DATABASE_URL = "file:./data/mesh.db"

let instance: LibSQLDatabase<typeof schema> | undefined

/** Lazily opened so `next build` never touches the database. */
export function getDb() {
  if (!instance) {
    const url = process.env.DATABASE_URL || DEFAULT_DATABASE_URL
    if (url.startsWith("file:")) mkdirSync(dirname(url.slice("file:".length)), { recursive: true })
    const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined })
    client.execute("PRAGMA foreign_keys = ON").catch((error) => console.error("Unable to enable foreign keys", error))
    instance = drizzle(client, { schema })
  }
  return instance
}
