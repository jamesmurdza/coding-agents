#!/usr/bin/env npx tsx
/**
 * Test Claude's write file tool call output
 */
import { createSandbox, createProvider } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!

async function main() {
  console.log("=== Claude Write File Tool Test ===\n")

  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
    env: { ANTHROPIC_API_KEY },
  })

  await sandbox.create()
  console.log("Sandbox created\n")

  try {
    const provider = createProvider("claude", { sandbox })

    let toolOutput = ""
    let currentToolName = ""

    for await (const event of provider.run({
      prompt: "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else.",
    })) {
      switch (event.type) {
        case "session":
          console.log(`[SESSION] ${event.id}`)
          break
        case "token":
          process.stdout.write(event.text)
          break
        case "tool_start":
          currentToolName = event.name
          console.log(`\n>>> TOOL_START: "${event.name}"`)
          toolOutput = ""
          break
        case "tool_delta":
          toolOutput += event.text
          break
        case "tool_end":
          console.log(`>>> TOOL_END`)
          console.log(`>>> TOOL NAME: "${currentToolName}"`)
          console.log(`>>> RAW TOOL CONTENT:`)
          console.log("---BEGIN---")
          console.log(toolOutput)
          console.log("---END---")
          break
        case "end":
          console.log(`\n[END]`)
          break
      }
    }
  } finally {
    await sandbox.destroy()
    console.log("Sandbox destroyed")
  }
}

main().catch(console.error)
