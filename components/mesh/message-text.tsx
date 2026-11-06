import { Fragment, type ReactNode } from "react"

/** Renders **bold** as React nodes. Model text is never treated as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
      : <Fragment key={index}>{part}</Fragment>,
  )
}

const BULLET = /^\s*[-*•]\s+/

/** The small markdown subset the agents are told to use: paragraphs, bullets, bold. */
export function MessageText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length === 0) return
    blocks.push(<ul key={blocks.length} className="list-disc space-y-1 pl-5">{bullets.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>)
    bullets = []
  }
  for (const line of text.split("\n")) {
    if (BULLET.test(line)) {
      bullets.push(line.replace(BULLET, ""))
      continue
    }
    flush()
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>)
  }
  flush()
  return <div className="space-y-2">{blocks}</div>
}
