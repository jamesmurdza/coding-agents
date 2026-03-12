# Code Agent SDK

A TypeScript SDK for interacting with various AI coding agents through a unified interface. **By default, all commands run in a secure Daytona sandbox** to prevent arbitrary code execution on your local machine.

## Provider Support

| Provider | Status | CLI | Authentication |
|----------|--------|-----|----------------|
| Claude | **Tested** | `claude` | `ANTHROPIC_API_KEY` env var |
| Codex | **Tested** | `codex` | `codex login --with-api-key` or device auth |
| OpenCode | Implemented | `opencode` | `OPENCODE_API_KEY` env var |
| Gemini | Implemented | `gemini` | `GOOGLE_API_KEY` env var |

## Installation

```bash
npm install code-agent-sdk
```

## Quick Start

### Sandbox Mode (Recommended)

By default, all providers run inside a secure [Daytona](https://daytona.io) sandbox. This isolates the CLI execution from your local machine.

```typescript
import { createSandbox, createProvider } from "code-agent-sdk"

// 1. Create a sandbox
const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
})

// 2. Create the sandbox instance
await sandbox.create()

// 3. Create provider with sandbox
const provider = createProvider("claude", { sandbox })

// 4. Run prompts securely
for await (const event of provider.run({ prompt: "Hello, world!" })) {
  if (event.type === "token") {
    process.stdout.write(event.text)
  }
}

// 5. Cleanup when done
await sandbox.destroy()
```

### Local Mode (Dangerous - Use with Caution)

If you need to run locally (e.g., for development or when you trust the code), explicitly opt-in:

```typescript
import { createProvider } from "code-agent-sdk"

// WARNING: Runs directly on your local machine
const provider = createProvider("claude", {
  dangerouslyAllowLocalExecution: true,
})

const response = await provider.collectText({
  prompt: "What is 2 + 2?",
})
console.log(response) // "4"
```

## API

### Creating a Sandbox

```typescript
import { createSandbox } from "code-agent-sdk"

const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,      // Daytona API key
  serverUrl: "https://api.daytona.io",       // Optional: Daytona server URL
  autoStopTimeout: 300,                       // Optional: Auto-stop after 5 min
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  },
})

await sandbox.create()
```

### Creating a Provider

```typescript
// With sandbox (recommended)
const provider = createProvider("claude", { sandbox })

// Or with dangerous local execution
const provider = createProvider("claude", {
  dangerouslyAllowLocalExecution: true,
})
```

### Running Prompts

```typescript
// Streaming with async generator
for await (const event of provider.run({ prompt: "Hello" })) {
  switch (event.type) {
    case "session":
      console.log("Session:", event.id)
      break
    case "token":
      process.stdout.write(event.text)
      break
    case "tool_start":
      console.log("Using tool:", event.name)
      break
    case "end":
      console.log("\n[Done]")
      break
  }
}

// Callback style
await provider.runWithCallback((event) => {
  if (event.type === "token") {
    process.stdout.write(event.text)
  }
}, { prompt: "Hello" })

// Collect full text response
const text = await provider.collectText({ prompt: "Hello" })

// Collect all events
const events = await provider.collectEvents({ prompt: "Hello" })
```

### Run Options

```typescript
interface RunOptions {
  prompt?: string              // The prompt to send
  sessionId?: string           // Session ID to resume
  persistSession?: boolean     // Save session to file (default: true, local only)
  sessionFile?: string         // Custom session file path (local only)
  cwd?: string                 // Working directory
  env?: Record<string, string> // Additional environment variables
  autoInstall?: boolean        // Auto-install CLI if missing (default: true)
  timeout?: number             // Timeout in seconds (default: 120)
}
```

### Event Types

```typescript
type Event =
  | { type: "session"; id: string }      // Session started
  | { type: "token"; text: string }      // Text from assistant
  | { type: "tool_start"; name: string } // Tool invocation started
  | { type: "tool_delta"; text: string } // Tool input streaming
  | { type: "tool_end" }                 // Tool invocation ended
  | { type: "end" }                      // Turn complete
```

### Using the Sandbox Directly

```typescript
import { createSandbox } from "code-agent-sdk"

const sandbox = createSandbox({
  apiKey: process.env.DAYTONA_API_KEY,
})

await sandbox.create()

// Install a CLI
await sandbox.ensureProvider("claude")

// Set environment variables
sandbox.setEnv("ANTHROPIC_API_KEY", "sk-...")
sandbox.setEnvVars({ FOO: "bar", BAZ: "qux" })

// Execute commands
const result = await sandbox.executeCommand("claude --version")
console.log(result.output)
console.log(result.exitCode)

// Stream command output line by line
for await (const line of sandbox.executeCommandStream("claude -p 'Hello'")) {
  console.log(line)
}

// Cleanup when done
await sandbox.destroy()
```

## Environment Variables

```bash
# Daytona (for sandbox mode)
DAYTONA_API_KEY=your-daytona-api-key

# Provider API keys (passed to sandbox or local CLI)
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
OPENAI_API_KEY=sk-your-key-here
GOOGLE_API_KEY=AIza-your-key-here
OPENCODE_API_KEY=your-key-here
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run sandbox integration test
npx tsx scripts/test-streaming-sandbox.ts
```

## Security

- **Sandbox mode (default)**: CLI commands run in an isolated Daytona sandbox, protecting your local machine from arbitrary code execution
- **Local mode (opt-in)**: Commands run directly on your machine - only use this when you trust the code being executed
- **Auto-install**: In sandbox mode, CLIs are automatically installed in the sandbox (not on your machine)

## License

MIT
