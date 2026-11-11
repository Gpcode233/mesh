import { isWebUrl } from "@/lib/rfq"

/**
 * Public web search for supplier discovery, through the Tavily search API (https://tavily.com).
 * The key stays on the server. Results are untrusted page text: callers must treat them as data.
 */

export type SearchResult = { title: string; url: string; snippet: string }

export class SearchError extends Error {}

const MAX_RESULTS = 5
const TIMEOUT_MS = 15_000

function searchConfig() {
  const apiKey = process.env.MESH_SEARCH_API_KEY || process.env.TAVILY_API_KEY
  const baseURL = (process.env.MESH_SEARCH_BASE_URL || "https://api.tavily.com").replace(/\/+$/, "")
  return apiKey ? { apiKey, baseURL } : null
}

/** Strips control characters and caps length: page text goes into a model prompt. */
function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const config = searchConfig()
  if (!config) throw new SearchError("Web search is not configured on this server (MESH_SEARCH_API_KEY is not set). Nothing was searched.")
  let response: Response
  try {
    response = await fetch(`${config.baseURL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: "basic", include_answer: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new SearchError("Unable to reach the web search service. Nothing was searched.")
  }
  if (response.status === 401 || response.status === 403) throw new SearchError("The web search key was rejected.")
  if (!response.ok) throw new SearchError(`Web search returned ${response.status}.`)
  const body = (await response.json().catch(() => null)) as { results?: unknown } | null
  if (!body || !Array.isArray(body.results)) throw new SearchError("Web search returned an unreadable response.")
  const results: SearchResult[] = []
  for (const entry of body.results as Array<Record<string, unknown>>) {
    if (typeof entry?.url !== "string" || entry.url.length > 500 || !isWebUrl(entry.url)) continue
    const url = new URL(entry.url).href
    results.push({ url, title: clean(entry.title, 150) || url, snippet: clean(entry.content, 300) })
    if (results.length === MAX_RESULTS) break
  }
  return results
}
