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
    "include-reasoning": { type: "boolean" },
    "include-tool-output": { type: "boolean" },
    server: { type: "string" },
  },
})

const help = `Usage: bun sessions.ts <command> [argument] [options]

Commands:
  list                  List sessions, newest updated first
  search <text>         Search message bodies (case-insensitive literal text)
  dump <session-id>     Dump native message objects as chronological JSONL

Options:
  --title <text>        Filter session titles (case-insensitive literal text)
  --directory <path>    Filter sessions by directory via the V2 API
  --project <id>        Filter sessions by project ID
  --since <date>        Include sessions updated on/after this ISO date
  --until <date>        Include sessions updated before this ISO date
  --session <id>        Search just one session
  --limit <n>           Max list/search records (default 50; 0 = unlimited)
  --include-reasoning   Also search assistant reasoning (dumps always retain it)
  --include-tool-output Include tool results/errors and shell output in search/dump
  --server <url>       Forward an explicit server to opencode api
  --help               Show this help

All output is JSONL on stdout. Diagnostics go to stderr.
Default search scope: all sessions, user/assistant text only.
Dump ignores list/search filters and limits; tool results are omitted by default.
`

if (values.help || !positionals.length) {
  process.stdout.write(help)
  process.exit(0)
}

const [command = "", argument = ""] = positionals
if (!["list", "search", "dump"].includes(command) ||
    positionals.length !== (command === "list" ? 1 : 2) ||
    (command !== "list" && !argument)) {
  throw new Error("Expected list, search <text>, or dump <session-id>. See --help.")
}

const limit = Number(values.limit)
const since = values.since === undefined ? -Infinity : Date.parse(values.since)
const until = values.until === undefined ? Infinity : Date.parse(values.until)
if (!Number.isInteger(limit) || limit < 0 || Number.isNaN(since) || Number.isNaN(until)) {
  throw new Error("Use a nonnegative integer --limit and valid ISO dates for --since/--until.")
}

type Session = {
  id: string
  title?: string
  projectID: string
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
  text?: string
  content?: Part[]
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
    const query = new URLSearchParams({ ...filters, limit: "100" })
    if (cursor) query.set("cursor", cursor)
    else query.set("order", order)
    const page = await api<{ data: T[]; cursor: { next?: string | null } }>(`${path}?${query}`)
    yield* page.data
    cursor = page.cursor.next ?? undefined
  } while (cursor)
}

async function* sessions() {
  if (values.session) {
    yield await api<Session>(`/api/session/${encodeURIComponent(values.session)}`)
    return
  }
  const filters: Record<string, string> = {}
  if (values.directory) filters.directory = resolve(values.directory)
  if (values.project) filters.project = values.project
  yield* pages<Session>("/api/session", filters, "desc")
}

if (command === "dump") {
  for await (const message of pages<Message>(`/api/session/${encodeURIComponent(argument)}/message`, {}, "asc")) {
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
} else {
  const needle = argument.toLowerCase()
  let count = 0
  outer: for await (const session of sessions()) {
    if (session.time.updated < since || session.time.updated >= until) continue
    if (values.title && !session.title?.toLowerCase().includes(values.title.toLowerCase())) continue
    // Also apply these filters when --session bypasses the session list endpoint.
    if (values.directory && session.location.directory !== resolve(values.directory)) continue
    if (values.project && session.projectID !== values.project) continue
    if (command === "list") {
      process.stdout.write(JSON.stringify(session) + "\n")
      if (limit && ++count >= limit) break
      continue
    }
    for await (const message of pages<Message>(`/api/session/${encodeURIComponent(session.id)}/message`, {}, "asc")) {
      const fields: { field: string; text: string }[] = []
      if (message.type === "user") fields.push({ field: "text", text: message.text! })
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
        const offset = text.toLowerCase().indexOf(needle)
        if (offset === -1) continue
        process.stdout.write(JSON.stringify({
          sessionID: session.id,
          title: session.title,
          directory: session.location.directory,
          messageID: message.id,
          type: message.type,
          field,
          excerpt: text.slice(Math.max(0, offset - 120), offset + argument.length + 120),
        }) + "\n")
        if (limit && ++count >= limit) break outer
      }
    }
  }
}
