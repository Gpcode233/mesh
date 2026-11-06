import { NextRequest } from "next/server"
import { AGENTS, isAgentId } from "@/lib/agents"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

function getProviderConfig() {
  const provider = process.env.MESH_AI_PROVIDER ?? "google"
  const isGoogle = provider === "google" || provider === "gemini"
  const apiKey = isGoogle
    ? process.env.GEMINI_API_KEY
    : process.env.MESH_AI_API_KEY ?? process.env.OPENROUTER_API_KEY ?? process.env.GROQ_API_KEY
  const model = process.env.MESH_AI_MODEL ?? (
    isGoogle
      ? "gemini-2.5-flash"
      : provider === "groq"
        ? "llama-3.3-70b-versatile"
        : "openai/gpt-oss-20b:free"
  )
  const endpoint = process.env.MESH_AI_BASE_URL ?? (
    isGoogle
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
      : provider === "groq"
        ? "https://api.groq.com/openai/v1/chat/completions"
        : provider === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : ""
  )

  return { provider, apiKey, model, endpoint, isGoogle }
}

export async function POST(request: NextRequest) {
  let body: { agent?: unknown; context?: unknown; messages?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 })
  }
  const agent = body.agent ?? "head"
  const messages = (Array.isArray(body.messages) ? body.messages : []).filter(
    (message): message is ChatMessage =>
      typeof message === "object" && message !== null &&
      ((message as ChatMessage).role === "user" || (message as ChatMessage).role === "assistant") &&
      typeof (message as ChatMessage).content === "string" && (message as ChatMessage).content.trim().length > 0,
  )
  const config = getProviderConfig()

  if (!isAgentId(agent) || messages.length === 0) {
    return Response.json({ error: "A valid agent and at least one message are required." }, { status: 400 })
  }
  if (!config.apiKey || !config.endpoint) {
    return Response.json({
      error: "AI provider is not configured. Set MESH_AI_PROVIDER, MESH_AI_API_KEY, and MESH_AI_MODEL.",
    }, { status: 503 })
  }

  const safeMessages = messages
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }))
  const context = typeof body.context === "string" ? body.context.trim().slice(0, 4000) : ""
  const system = [
    AGENTS[agent].instruction,
    "You are operating inside Mesh, an autonomous B2B procurement console.",
    "Use concise, operational language. Separate observed facts, recommendations, and next actions.",
    "Other Mesh agents may appear in the transcript as [Name]: prefixed turns; answer only as yourself.",
    "Do not invent suppliers, quotes, chain transactions, attestations, or tool results.",
    context ? `Operator-provided context:\n${context}` : "",
  ].filter(Boolean).join("\n\n")

  try {
    const response = await fetch(config.isGoogle ? `${config.endpoint}?key=${encodeURIComponent(config.apiKey)}` : config.endpoint, {
      method: "POST",
      headers: {
        ...(config.isGoogle ? {} : { Authorization: `Bearer ${config.apiKey}` }),
        "Content-Type": "application/json",
        ...(config.provider === "openrouter" ? {
          "HTTP-Referer": process.env.MESH_APP_URL ?? "http://localhost:3000",
          "X-OpenRouter-Title": "Mesh",
        } : {}),
      },
      body: JSON.stringify(config.isGoogle ? {
        systemInstruction: { parts: [{ text: system }] },
        contents: safeMessages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          ...(config.model.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      } : {
        model: config.model,
        messages: [{ role: "system", content: system }, ...safeMessages],
        temperature: 0.2,
        max_tokens: 700,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error("Mesh AI provider error", { provider: config.provider, status: response.status, detail })
      return Response.json({ error: `AI provider returned ${response.status}.` }, { status: 502 })
    }

    const result = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const content = (config.isGoogle
      ? result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("")
      : result.choices?.[0]?.message?.content
    )?.trim()
    if (!content) {
      console.error("Mesh AI provider returned no assistant content", { provider: config.provider })
      return Response.json({ error: "AI provider returned an empty response." }, { status: 502 })
    }

    return Response.json({ agent, provider: config.provider, model: config.model, content })
  } catch (error) {
    console.error("Mesh AI request failed", error)
    return Response.json({ error: "Unable to reach the configured AI provider." }, { status: 502 })
  }
}
