import { describe, it, expect } from "vitest"
import type { CodeAgentSandbox, ProviderCommand, RunOptions } from "../../src/types/index.js"
import { Provider } from "../../src/providers/base.js"
import type { Event } from "../../src/types/index.js"

class FakeSandbox implements CodeAgentSandbox {
  private logs: Record<string, string> = {}
  private lastPid = 1234

  // store last command for debugging if needed
  lastCommand: string | null = null

  async ensureProvider(): Promise<void> {
    // no-op
  }

  setEnvVars(): void {
    // no-op
  }

  async *executeCommandStream(): AsyncGenerator<string, void, unknown> {
    // not used in these tests
    if (false) {
      yield ""
    }
  }

  async executeCommand(command: string): Promise<{ exitCode: number; output: string }> {
    this.lastCommand = command

    // Simulate background start command: bash -lc "... >> file 2>&1 & echo $!"
    if (command.includes("echo $!")) {
      this.lastPid += 1
      return { exitCode: 0, output: `${this.lastPid}\n` }
    }

    // Simulate cat <file>
    if (command.startsWith("cat ")) {
      const path = command.slice("cat ".length).trim()
      const output = this.logs[path] ?? ""
      return { exitCode: 0, output }
    }

    return { exitCode: 0, output: "" }
  }

  // Helper to set file contents
  setFile(path: string, content: string): void {
    this.logs[path] = content
  }
}

class TestProvider extends Provider {
  readonly name = "claude"

  // Simple command – we only care that startSandboxBackground wraps it correctly
  getCommand(_options?: RunOptions): ProviderCommand {
    return {
      cmd: "claude",
      args: ["-p", "--output-format", "stream-json", "hello"],
    }
  }

  // Parse JSONL lines into Event objects
  parse(line: string): Event | Event[] | null {
    try {
      const obj = JSON.parse(line) as Event
      return obj
    } catch {
      return null
    }
  }
}

describe("sandbox background mode", () => {
  it("startSandboxBackground returns execution info and cursor", async () => {
    const sandbox = new FakeSandbox()
    const provider = new TestProvider({ sandbox })
    // mark ready immediately
    await provider.ready

    const result = await provider.startSandboxBackground({
      prompt: "hello",
      outputFile: "/tmp/agent.log",
    })

    expect(result.executionId).toBeTypeOf("string")
    expect(result.executionId.length).toBeGreaterThan(0)
    expect(result.pid).toBeGreaterThan(0)
    expect(result.outputFile).toBe("/tmp/agent.log")
    expect(result.cursor).toBe("0")
  })

  it("pollSandboxBackground returns parsed events since cursor", async () => {
    const sandbox = new FakeSandbox()
    const provider = new TestProvider({ sandbox })
    await provider.ready

    const outputFile = "/tmp/agent.jsonl"

    // Simulate two JSONL events in the sandbox file
    const events: Event[] = [
      { type: "session", id: "sess-1" },
      { type: "token", text: "Hello" },
    ]
    const jsonl = events.map(e => JSON.stringify(e)).join("\n") + "\n"
    sandbox.setFile(outputFile, jsonl)

    const res1 = await provider.pollSandboxBackground(outputFile, null)
    expect(res1.cursor).toBe("2") // two lines
    expect(res1.sessionId).toBe("sess-1")
    expect(res1.events).toEqual(events)
    expect(res1.status).toBe("running")

    // No new content – should return empty events
    const res2 = await provider.pollSandboxBackground(outputFile, res1.cursor)
    expect(res2.events).toEqual([])
    expect(res2.cursor).toBe(res1.cursor)
  })
})

