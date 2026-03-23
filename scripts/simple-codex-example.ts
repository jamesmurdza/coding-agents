#!/usr/bin/env npx tsx
/**
 * Simple Codex example that demonstrates both streaming and background agent polling.
 * This script uses the Daytona SDK directly without importing the library.
 */
import { Daytona } from "@daytonaio/sdk"
import type { Sandbox } from "@daytonaio/sdk"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!DAYTONA_API_KEY || !OPENAI_API_KEY) {
  console.error("Required: DAYTONA_API_KEY and OPENAI_API_KEY")
  process.exit(1)
}

// Simple JSON line check
function isJsonLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith("{") && t.endsWith("}")
}

// Strip ANSI codes
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g, "")
}

// Parse a Codex JSON event and print it simply
function handleCodexEvent(json: any): boolean {
  if (json.type === "thread.started") {
    console.log(`  [session] ${json.thread_id}`)
    return false
  }
  if (json.type === "item.message.delta") {
    process.stdout.write(json.text)
    return false
  }
  if (json.type === "item.started" && json.item?.type === "command_execution") {
    console.log(`  [tool:shell] ${json.item.command}`)
    return false
  }
  if (json.type === "item.completed" && json.item?.type === "command_execution") {
    console.log(`  [tool:result] ${(json.item.aggregated_output || "").slice(0, 100)}`)
    return false
  }
  if (json.type === "turn.completed") {
    console.log("\n  [done]")
    return true
  }
  if (json.type === "turn.failed" || json.type === "error") {
    console.log(`\n  [error] ${json.error?.message || json.message}`)
    return true
  }
  return false
}

// ========== STREAMING MODE ==========
async function runStreaming(sandbox: Sandbox, prompt: string) {
  console.log("\n=== STREAMING MODE ===")
  console.log(`Prompt: "${prompt}"`)
  console.log("Response:")

  const command = `codex exec --json --skip-git-repo-check --yolo "${prompt.replace(/"/g, '\\"')}"`

  let buffer = ""
  const ptyId = `pty-${Date.now()}`
  const pty = await sandbox.process.createPty({
    id: ptyId,
    onData: (data: Uint8Array) => {
      const text = new TextDecoder().decode(data)
      buffer += text
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const cleaned = stripAnsi(line).trim()
        if (isJsonLine(cleaned)) {
          try {
            const json = JSON.parse(cleaned)
            handleCodexEvent(json)
          } catch {}
        }
      }
    },
  })

  await pty.waitForConnection()
  await pty.sendInput(`export OPENAI_API_KEY='${OPENAI_API_KEY}'; ${command}\n`)
  await pty.sendInput("exit\n")
  await pty.wait()
  await pty.disconnect()
}

// ========== BACKGROUND POLLING MODE ==========
async function runBackgroundPolling(sandbox: Sandbox, prompt: string) {
  console.log("\n=== BACKGROUND AGENT POLLING MODE ===")
  console.log(`Prompt: "${prompt}"`)

  const sessionId = `bg-${Date.now()}`
  const outputFile = `/tmp/${sessionId}.jsonl`
  const doneFile = `${outputFile}.done`

  // Create SSH access for background execution
  const sshAccess = await sandbox.createSshAccess(60)

  // Dynamically import ssh2
  const { Client: SshClient } = await import("ssh2")

  const conn = await new Promise<any>((resolve, reject) => {
    const c = new SshClient()
    c.on("ready", () => resolve(c))
    c.on("error", reject)
    c.connect({
      host: "ssh.app.daytona.io",
      port: 22,
      username: sshAccess.token,
    })
  })

  // Build command
  const command = `OPENAI_API_KEY='${OPENAI_API_KEY}' codex exec --json --skip-git-repo-check --yolo "${prompt.replace(/"/g, '\\"')}"`

  // Start background process with nohup
  const wrapper = `nohup sh -c '${command.replace(/'/g, "'\\''")} >> ${outputFile} 2>&1; echo 1 > ${doneFile}' > /dev/null 2>&1 & echo $!`

  const pid = await new Promise<number>((resolve, reject) => {
    conn.exec(wrapper, (err: any, stream: any) => {
      if (err) return reject(err)
      let output = ""
      stream.on("data", (d: Buffer) => (output += d.toString()))
      stream.on("close", () => resolve(parseInt(output.trim())))
    })
  })

  console.log(`Started background process with PID: ${pid}`)
  console.log(`Output file: ${outputFile}`)
  console.log("Polling for events...\n")

  // Poll for events
  let cursor = 0
  let done = false
  const seenLines = new Set<string>()

  while (!done) {
    await new Promise((r) => setTimeout(r, 500))

    // Check if done file exists
    const doneCheck = await sandbox.process.executeCommand(`test -f ${doneFile} && echo yes || echo no`)
    const isDone = (doneCheck.result ?? "").trim() === "yes"

    // Read output file
    const result = await sandbox.process.executeCommand(`cat ${outputFile} 2>/dev/null || echo ""`)
    const content = result.result ?? ""
    const lines = content.split("\n").filter((l) => l.trim())

    // Process new lines
    for (const line of lines) {
      if (seenLines.has(line)) continue
      seenLines.add(line)

      const cleaned = stripAnsi(line).trim()
      if (isJsonLine(cleaned)) {
        try {
          const json = JSON.parse(cleaned)
          if (handleCodexEvent(json)) {
            done = true
          }
        } catch {}
      }
    }

    // If .done file exists and no more events, we're done
    if (isDone && !done) {
      console.log("  [process exited]")
      done = true
    }
  }

  conn.end()
}

// ========== MAIN ==========
async function main() {
  console.log("============================================================")
  console.log("  Simple Codex Example - Streaming + Background Polling")
  console.log("============================================================")

  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  console.log("\nCreating sandbox...")
  const sandbox = await daytona.create({
    envVars: { OPENAI_API_KEY: OPENAI_API_KEY },
  })
  console.log("Sandbox created!")

  try {
    // Install Codex
    console.log("\nInstalling Codex CLI...")
    await sandbox.process.executeCommand("npm install -g @openai/codex", undefined, undefined, 120)

    // Login to Codex
    console.log("Logging in to Codex...")
    await sandbox.process.executeCommand(
      `echo "${OPENAI_API_KEY}" | codex login --with-api-key 2>&1`,
      undefined,
      undefined,
      30
    )
    console.log("Ready!")

    // Test 1: Streaming mode
    await runStreaming(sandbox, "Say hello briefly")

    // Test 2: Background polling mode
    await runBackgroundPolling(sandbox, "What is 2+2? Answer briefly.")

    console.log("\n============================================================")
    console.log("Both modes completed successfully!")
    console.log("============================================================")
  } finally {
    console.log("\nCleaning up sandbox...")
    await sandbox.delete()
    console.log("Done!")
  }
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
