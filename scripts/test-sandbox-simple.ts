#!/usr/bin/env npx tsx
/**
 * Simple sandbox test - just test that sandbox works
 */
import { createSandbox } from "../src/index.js"

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
if (!DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY environment variable required")
  process.exit(1)
}

async function main() {
  console.log("Creating sandbox...")
  const sandbox = createSandbox({
    apiKey: DAYTONA_API_KEY,
  })

  try {
    await sandbox.create()
    console.log("Sandbox created!")

    console.log("\nRunning 'echo Hello'...")
    const result = await sandbox.executeCommand("echo Hello")
    console.log("Result:", result)

    console.log("\nRunning 'which node'...")
    const result2 = await sandbox.executeCommand("which node")
    console.log("Result:", result2)

    console.log("\nTest passed!")
  } catch (error) {
    console.error("Error:", error)
    throw error
  } finally {
    console.log("\nDestroying sandbox...")
    await sandbox.destroy()
    console.log("Done!")
  }
}

main().catch((error) => {
  console.error("Test failed:", error)
  process.exit(1)
})
