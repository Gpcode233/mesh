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
    // Adjacent user turns are merged upstream, so only the newest paragraph is the current message.
    const last = (turns.at(-1)?.parts?.[0]?.text ?? "").split("\n\n").at(-1)
    const token = last.match(/tok-\w+/g)?.at(-1) ?? "none"
    response.setHeader("Content-Type", "application/json")
    if (last.includes("FAIL_PROVIDER")) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: { message: "forced failure" } }))
      return
    }
    // Only call the tool when the server actually offered it, as a real model would.
    const offered = (body.tools ?? []).length > 0
    if (offered && last.includes("PROPOSE_RFQ")) {
      const args = { resource: `Steel ${token}`, quantity: 10, unit: "t", maxBudget: 5000, deadline: "2099-01-01", destination: "Hamburg" }
      response.end(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "propose_rfq", args } }] } }] }))
      return
    }
    if (offered && last.includes("PROPOSE_BAD")) {
      const args = { resource: `Steel ${token}`, quantity: -5, unit: "t", maxBudget: 5000, deadline: "2099-01-01", destination: "Hamburg" }
      response.end(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "propose_rfq", args } }] } }] }))
      return
    }
    const text = `**bold-${token}** reply-from-${agent} ${token} turns=${turns.length}`
    response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }))
  })
}).listen(3101)
