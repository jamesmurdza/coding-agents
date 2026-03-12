#!/usr/bin/env npx tsx
/**
 * Test script to capture what "write file" tool calls look like for each provider
 */
import { createSandbox, createProvider } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

async function testProvider(
  name: string,
  providerType: "claude" | "codex" | "gemini" | "opencode",
  sandbox: any,
  extraSetup?: () => Promise<void>
) {
  console.log("\n" + "=".repeat(70))
  console.log(`  ${name} - Write File Tool Call`)
  console.log("=".repeat(70))

  try {
    if (extraSetup) await extraSetup()

    const provider = createProvider(providerType, { sandbox })

    let toolOutput = ""
    let currentToolName = ""

    for await (const event of provider.run({
      prompt: "Write a file called /tmp/hello.txt with the content 'Hello World'. Just write the file, nothing else.",
      autoInstall: providerType !== "codex", // Skip install for codex if already done
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
          console.log(`>>> TOOL CONTENT:`)
          console.log(toolOutput)
          console.log(`>>> END TOOL CONTENT`)
          break
        case "end":
          console.log(`\n[END]`)
          break
      }
    }

    console.log(`\n✓ ${name} test completed!`)
  } catch (error) {
    console.error(`\n✗ ${name} error:`, error)
  }
}

async function main() {
  console.log("============================================================")
  console.log("  Testing Write File Tool Calls for All Providers")
  console.log("============================================================")

  // Test Claude
  if (ANTHROPIC_API_KEY) {
    console.log("\n--- Creating sandbox for Claude ---")
    const sandbox = createSandbox({
      apiKey: DAYTONA_API_KEY!,
      env: { ANTHROPIC_API_KEY },
    })
    await sandbox.create()
    try {
      await testProvider("Claude", "claude", sandbox)
    } finally {
      await sandbox.destroy()
    }
  } else {
    console.log("\nSkipping Claude (no ANTHROPIC_API_KEY)")
  }

  // Test Codex
  if (OPENAI_API_KEY) {
    console.log("\n--- Creating sandbox for Codex ---")
    const sandbox = createSandbox({
      apiKey: DAYTONA_API_KEY!,
      env: { OPENAI_API_KEY },
    })
    await sandbox.create()
    try {
      // Install and login codex
      console.log("Installing Codex CLI...")
      await sandbox.executeCommand("npm install -g @openai/codex", 120)
      console.log("Logging in...")
      await sandbox.executeCommand(`echo "${OPENAI_API_KEY}" | codex login --with-api-key 2>&1`, 30)

      await testProvider("Codex", "codex", sandbox)
    } finally {
      await sandbox.destroy()
    }
  } else {
    console.log("\nSkipping Codex (no OPENAI_API_KEY)")
  }

  // Test Gemini
  if (GEMINI_API_KEY) {
    console.log("\n--- Creating sandbox for Gemini ---")
    const sandbox = createSandbox({
      apiKey: DAYTONA_API_KEY!,
      env: { GOOGLE_API_KEY: GEMINI_API_KEY },
    })
    await sandbox.create()
    try {
      await testProvider("Gemini", "gemini", sandbox)
    } finally {
      await sandbox.destroy()
    }
  } else {
    console.log("\nSkipping Gemini (no GEMINI_API_KEY)")
  }

  // Test OpenCode
  if (OPENAI_API_KEY) {
    console.log("\n--- Creating sandbox for OpenCode ---")
    const sandbox = createSandbox({
      apiKey: DAYTONA_API_KEY!,
      env: { OPENAI_API_KEY },
    })
    await sandbox.create()
    try {
      await testProvider("OpenCode", "opencode", sandbox)
    } finally {
      await sandbox.destroy()
    }
  } else {
    console.log("\nSkipping OpenCode (no OPENAI_API_KEY)")
  }

  console.log("\n" + "=".repeat(70))
  console.log("  All tests completed!")
  console.log("=".repeat(70))
}

main().catch((error) => {
  console.error("Test failed:", error)
  process.exit(1)
})
