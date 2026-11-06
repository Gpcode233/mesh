// Stand-in for the Gemini REST API so e2e tests exercise the real server path without network or cost.
import { createServer } from "node:http"

createServer((request, response) => {
  let raw = ""
  request.on("data", (chunk) => { raw += chunk })
  request.on("end", () => {
    const body = JSON.parse(raw || "{}")
    const system = body.systemInstruction?.parts?.[0]?.text ?? ""
    const agent = /You are Mesh (\w+) Agent/.exec(system)?.[1]?.toLowerCase() ?? "unknown"
    const turns = body.contents ?? []
    const last = turns.at(-1)?.parts?.[0]?.text ?? ""
    const token = last.match(/tok-\w+/g)?.at(-1) ?? "none"
    response.setHeader("Content-Type", "application/json")
    if (last.includes("FAIL_PROVIDER")) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: { message: "forced failure" } }))
      return
    }
    const text = `**bold-${token}** reply-from-${agent} ${token} turns=${turns.length}`
    response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }))
  })
}).listen(3101)
