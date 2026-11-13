#!/usr/bin/env bun
import { parseArgs } from "node:util"
import { resolve } from "node:path"

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    title: { type: "string" },
    directory: { type: "string" },
    project: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    session: { type: "string" },
    limit: { type: "string", default: "50" },
    regex: { type: "boolean" },
    context: { type: "string", default: "120" },
    "include-reasoning": { type: "boolean" },
    "include-tool-output": { type: "boolean" },
    server: { type: "string" },
  },
})

const help = `Usage: bun sessions.ts <command> [argument...] [options]

Commands:
  list                  List sessions, newest updated first
  search <term>...      Search message bodies; every term must appear in the same text
  outline <session-id>  Print user prompts, final answers, and compaction summaries
  dump <session-id>     Dump native message objects as chronological JSONL

Options:
  --title <text>        Filter session titles (case-insensitive literal text)
  --directory <path>    Filter sessions by directory via the V2 API
  --project <id>        Filter sessions by project ID
  --since <date>        Include sessions updated on/after this ISO date
  --until <date>        Include sessions updated before this ISO date
  --session <id>        Search just one session
  --limit <n>           Max list/search records (default 50; 0 = unlimited)
  --regex               Treat search terms as regular expressions
  --context <chars>     Characters of excerpt around each search match (default 120)
  --include-reasoning   Also search assistant reasoning (dumps always retain it)
  --include-tool-output Include tool results/errors and shell output in search/dump
  --server <url>       Forward an explicit server to opencode api
  --help               Show this help

All output is JSONL on stdout. Diagnostics go to stderr. Times are ISO 8601 UTC.
Search terms are case-insensitive. Quote a term to match a phrase.
Default search scope: all sessions; user text, assistant text, compaction summaries.
Outline and dump ignore list/search filters and limits; dump omits tool results by default.
`

if (values.help || !positionals.length) {
  process.stdout.write(help)
  process.exit(0)
}

const [command = "", ...terms] = positionals
const arity: Record<string, [number, number]> = { list: [0, 0], search: [1, Infinity], outline: [1, 1], dump: [1, 1] }
if (!arity[command] || terms.length < arity[command][0] || terms.length > arity[command][1]) {
  throw new Error("Expected list, search <term>..., outline <session-id>, or dump <session-id>. See --help.")
}

const limit = Number(values.limit)
const context = Number(values.context)
const since = values.since === undefined ? -Infinity : Date.parse(values.since)
const until = values.until === undefined ? Infinity : Date.parse(values.until)
if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(context) || context < 0 || Number.isNaN(since) || Number.isNaN(until)) {
  throw new Error("Use nonnegative integers for --limit/--context and valid ISO dates for --since/--until.")
}

type Session = {
  id: string
  parentID?: string
  title?: string
  projectID: string
  agent?: string
  model?: { id: string; providerID: string }
  location: { directory: string }
  time: { created: number; updated: number }
}

type Part = {
  type: string
  text?: string
  name?: string
  state?: {
    content?: { type: string; text?: string }[]
    error?: unknown
    metadata?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

type Message = {
  id: string
  type: string
  time: { created: number }
  text?: string
  content?: Part[]
  finish?: string
  summary?: string
  native?: { messages: { content: { text?: string }[] }[] }
  output?: { output: string }
  [key: string]: unknown
}

// Keep CLI-owned discovery and authentication, including explicit server selection.
async function api<T>(path: string): Promise<T> {
  const args = ["opencode", "api", "get", path]
  if (values.server) args.push("--server", values.server)
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "inherit" })
  const output = await new Response(child.stdout).text()
  if (await child.exited !== 0) throw new Error(`opencode api failed: ${path}`)
  return JSON.parse(output)
}

async function* pages<T>(path: string, filters: Record<string, string>, order: "asc" | "desc") {
  let cursor: string | undefined
  do {
    const query = new URLSearchParams({ ...filters, limit: "200" })
    if (cursor) query.set("cursor", cursor)
    else query.set("order", order)
    const page = await api<{ data: T[]; cursor: { next?: string | null } }>(`${path}?${query}`)
    yield* page.data
    cursor = page.cursor.next ?? undefined
  } while (cursor)
}

function messages(sessionID: string) {
  return pages<Message>(`/api/session/${encodeURIComponent(sessionID)}/message`, {}, "asc")
}

async function* sessions() {
  if (values.session) {
    yield (await api<{ data: Session }>(`/api/session/${encodeURIComponent(values.session)}`)).data
    return
  }
  const filters: Record<string, string> = {}
  if (values.directory) filters.directory = resolve(values.directory)
  if (values.project) filters.project = values.project
  yield* pages<Session>("/api/session", filters, "desc")
}

// Provider-native compaction keeps its text in native messages instead of summary.
function summary(message: Message) {
  const native = message.native?.messages.flatMap((item) => item.content.map((part) => part.text)) ?? []
  return [message.summary, ...native].filter(Boolean).join("\n\n")
}

const patterns = terms.map((term) => new RegExp(values.regex ? term : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))

// One excerpt per cluster of matches; empty unless every term matches the text.
function excerpts(text: string) {
  const ranges: [number, number][] = []
  for (const pattern of patterns) {
    const found = [...text.matchAll(pattern)]
    if (!found.length) return []
    for (const match of found) ranges.push([match.index - context, match.index + match[0].length + context])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [start, end] of ranges) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged.map(([start, end]) => text.slice(Math.max(0, start), end))
}

if (command === "dump") {
  for await (const message of messages(terms[0])) {
    if (!values["include-tool-output"]) {
      if (message.type === "shell") delete message.output
      if (message.type === "assistant") {
        for (const part of message.content!) {
          if (part.type !== "tool") continue
          delete part.state!.content
          delete part.state!.error
          delete part.state!.metadata
          delete part.providerResultState
        }
      }
    }
    process.stdout.write(JSON.stringify(message) + "\n")
  }
} else if (command === "outline") {
  for await (const message of messages(terms[0])) {
    let text = ""
    if (message.type === "user") text = message.text!
    if (message.type === "compaction") text = summary(message)
    if (message.type === "assistant" && message.finish !== "tool-calls") {
      text = message.content!.filter((part) => part.type === "text").map((part) => part.text).join("\n\n")
    }
    if (!text) continue
    process.stdout.write(JSON.stringify({
      messageID: message.id,
      time: new Date(message.time.created).toISOString(),
      type: message.type,
      text,
    }) + "\n")
  }
} else {
  let count = 0
  outer: for await (const session of sessions()) {
    if (session.time.updated < since || session.time.updated >= until) continue
    if (values.title && !session.title?.toLowerCase().includes(values.title.toLowerCase())) continue
    // Also apply these filters when --session bypasses the session list endpoint.
    if (values.directory && session.location.directory !== resolve(values.directory)) continue
    if (values.project && session.projectID !== values.project) continue
    if (command === "list") {
      process.stdout.write(JSON.stringify({
        id: session.id,
        parentID: session.parentID,
        title: session.title,
        directory: session.location.directory,
        created: new Date(session.time.created).toISOString(),
        updated: new Date(session.time.updated).toISOString(),
        agent: session.agent,
        model: session.model && `${session.model.providerID}/${session.model.id}`,
      }) + "\n")
      if (limit && ++count >= limit) break
      continue
    }
    for await (const message of messages(session.id)) {
      const fields: { field: string; text: string }[] = []
      if (message.type === "user") fields.push({ field: "text", text: message.text! })
      if (message.type === "compaction") fields.push({ field: "summary", text: summary(message) })
      if (message.type === "assistant") {
        for (const [index, part] of message.content!.entries()) {
          if (part.type === "text" || (part.type === "reasoning" && values["include-reasoning"])) {
            fields.push({ field: `content.${index}.${part.type}`, text: part.text! })
          }
          if (part.type === "tool" && values["include-tool-output"]) {
            for (const [resultIndex, result] of (part.state!.content ?? []).entries()) {
              if (result.type === "text") fields.push({ field: `content.${index}.state.content.${resultIndex}.text`, text: result.text! })
            }
            if (part.state!.error) fields.push({ field: `content.${index}.state.error`, text: JSON.stringify(part.state!.error) })
          }
        }
      }
      if (message.type === "shell" && values["include-tool-output"] && message.output) {
        fields.push({ field: "output.output", text: message.output.output })
      }
      for (const { field, text } of fields) {
        for (const excerpt of excerpts(text)) {
          process.stdout.write(JSON.stringify({
            sessionID: session.id,
            title: session.title,
            directory: session.location.directory,
            messageID: message.id,
            time: new Date(message.time.created).toISOString(),
            type: message.type,
            field,
            excerpt,
          }) + "\n")
          if (limit && ++count >= limit) break outer
        }
      }
    }
  }
}
