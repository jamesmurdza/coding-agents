#!/usr/bin/env npx tsx
/**
 * Run Claude and Codex with the same write-file prompt and compare normalized event output.
 * Exit 0 if same, 1 if different.
 */
import { createSandbox, createProvider } from "../src/index.js"
import type { Event } from "../src/types/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

const SCENARIOS: { name: string; prompt: string }[] = [
  {
    name: "write",
    prompt:
      "Write a file called /tmp/test.txt with the content 'Hello World'. Use the write/file tool only—do not run any shell commands.",
  },
  {
    name: "read",
    prompt:
      "Create /tmp/readme.txt with content 'Hello' using the write tool, then read /tmp/readme.txt using the read tool and tell me its contents. Use only write and read tools, no shell.",
  },
  {
    name: "shell",
    prompt: "Run the shell command 'echo hello' and tell me the output. Use only the shell/command execution tool.",
  },
]

function normalize(e: Event): string {
  if (e.type === "session") return `session:${e.id ? "id" : ""}`
  if (e.type === "token") return "token"
  if (e.type === "tool_start") {
    const input = (e as { input?: unknown }).input
    const name = (e as { name: string }).name
    let hint = "other"
    if (input && typeof input === "object") {
      if ("file_path" in input || "path" in input) hint = "path"
      else if ("command" in input) hint = "command"
    }
    return `tool_start:${name}:${hint}`
  }
  if (e.type === "tool_end") return "tool_end"
  if (e.type === "end") return "end"
  return (e as { type: string }).type
}

async function collectEvents(providerType: "claude" | "codex", prompt: string): Promise<Event[]> {
  const envKey = providerType === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
  const apiKey = providerType === "claude" ? ANTHROPIC_API_KEY : OPENAI_API_KEY
  const sandbox = createSandbox({ apiKey: DAYTONA_API_KEY, env: { [envKey]: apiKey } })
  await sandbox.create()
  try {
    if (providerType === "codex") {
      await sandbox.executeCommand("npm install -g @openai/codex", 120)
      await sandbox.executeCommand(`echo "${apiKey}" | codex login --with-api-key 2>&1`, 30)
    }
    const provider = createProvider(providerType, { sandbox })
    const events: Event[] = []
    for await (const e of provider.run({ prompt, autoInstall: providerType !== "codex" })) {
      events.push(e)
    }
    return events
  } finally {
    await sandbox.destroy()
  }
}

function structure(events: Event[]): string[] {
  return events.map(normalize).filter((x) => x !== "token")
}

async function main() {
  let failed = false
  for (const scenario of SCENARIOS) {
    process.stdout.write(`Scenario "${scenario.name}": Claude... `)
    const claudeEvents = await collectEvents("claude", scenario.prompt)
    process.stdout.write("Codex... ")
    const codexEvents = await collectEvents("codex", scenario.prompt)
    const a = structure(claudeEvents)
    const b = structure(codexEvents)
    const same = a.length === b.length && a.every((v, i) => v === b[i])
    if (same) {
      console.log("OK")
    } else {
      console.log("DIFF")
      console.error("  Claude:", a.join(" → "))
      console.error("  Codex:", b.join(" → "))
      failed = true
    }
  }
  if (failed) process.exit(1)
  console.log("All scenarios: Claude and Codex produce the same normalized output.")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
