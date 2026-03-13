import { describe, it, expect } from "vitest"
import type { CodeAgentSandbox, ProviderCommand, RunOptions } from "../../src/types/index.js"
import { Provider } from "../../src/providers/base.js"
import type { Event } from "../../src/types/index.js"

class FakeSandbox implements CodeAgentSandbox {
  private logs: Record<string, string> = {}
  private lastPid = 1234

  lastCommand: string | null = null

  async ensureProvider(): Promise<void> {}

  setEnvVars(): void {}

  async *executeCommandStream(): AsyncGenerator<string, void, unknown> {
    if (false) yield ""
  }

  async executeCommand(command: string): Promise<{ exitCode: number; output: string }> {
    this.lastCommand = command

    if (command.includes("echo $!")) {
      this.lastPid += 1
      return { exitCode: 0, output: `${this.lastPid}\n` }
    }

    if (command.startsWith("cat ")) {
      const match = command.match(/cat "([^"]+)"/)
      const path = match ? match[1] : command.slice(4).trim().split(/\s/)[0]
      const output = this.logs[path] ?? ""
      return { exitCode: 0, output }
    }

    if (command.includes("base64 -d")) {
      const match = command.match(/echo '([^']*)' \| base64 -d > "([^"]+)"/)
      if (match) {
        const [, b64, path] = match
        this.logs[path] = Buffer.from(b64!, "base64").toString("utf8")
        return { exitCode: 0, output: "" }
      }
    }

    if (command.startsWith("mkdir -p")) {
      return { exitCode: 0, output: "" }
    }

    return { exitCode: 0, output: "" }
  }

  setFile(path: string, content: string): void {
    this.logs[path] = content
  }

  getFile(path: string): string | undefined {
    return this.logs[path]
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
    const events: Event[] = [
      { type: "session", id: "sess-1" },
      { type: "token", text: "Hello" },
    ]
    const jsonl = events.map(e => JSON.stringify(e)).join("\n") + "\n"
    sandbox.setFile(outputFile, jsonl)

    const res1 = await provider.pollSandboxBackground(outputFile, null)
    expect(res1.cursor).toBe("2")
    expect(res1.sessionId).toBe("sess-1")
    expect(res1.events).toEqual(events)
    expect(res1.status).toBe("running")

    const res2 = await provider.pollSandboxBackground(outputFile, res1.cursor)
    expect(res2.events).toEqual([])
    expect(res2.cursor).toBe(res1.cursor)
  })

  it("startSandboxBackgroundTurn creates session dir meta and returns execution info", async () => {
    const sandbox = new FakeSandbox()
    const provider = new TestProvider({ sandbox })
    await provider.ready
    const sessionDir = "/tmp/codeagent-test"

    const result = await provider.startSandboxBackgroundTurn(sessionDir, { prompt: "hi" })

    expect(result.executionId).toBeTypeOf("string")
    expect(result.pid).toBeGreaterThan(0)
    expect(result.outputFile).toBe(`${sessionDir}/0.jsonl`)
    const metaJson = sandbox.getFile(`${sessionDir}/meta.json`)
    expect(metaJson).toBeDefined()
    const meta = JSON.parse(metaJson!)
    expect(meta.currentTurn).toBe(0)
    expect(meta.cursor).toBe(0)
    expect(meta.pid).toBe(result.pid)
  })

  it("getEventsSandboxBackgroundFromMeta reads log and updates meta", async () => {
    const sandbox = new FakeSandbox()
    const provider = new TestProvider({ sandbox })
    await provider.ready
    const sessionDir = "/tmp/codeagent-test"
    sandbox.setFile(
      `${sessionDir}/meta.json`,
      JSON.stringify({ currentTurn: 0, cursor: 0, pid: 1235 })
    )
    const events: Event[] = [
      { type: "session", id: "sess-2" },
      { type: "token", text: "World" },
    ]
    sandbox.setFile(
      `${sessionDir}/0.jsonl`,
      events.map(e => JSON.stringify(e)).join("\n") + "\n"
    )

    const res = await provider.getEventsSandboxBackgroundFromMeta(sessionDir)

    expect(res.events).toEqual(events)
    expect(res.cursor).toBe("2")
    expect(res.sessionId).toBe("sess-2")
    const metaJson = sandbox.getFile(`${sessionDir}/meta.json`)
    const meta = JSON.parse(metaJson!)
    expect(meta.cursor).toBe(2)
  })
})

