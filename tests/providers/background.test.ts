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

    // test -f 'path' 2>/dev/null; echo $? (done file check for isRunning)
    const testFMatch = command.match(/test -f '([^']+)'/)
    if (testFMatch) {
      const path = testFMatch[1]
      const exists = this.logs[path] !== undefined
      return { exitCode: 0, output: exists ? "0\n" : "1\n" }
    }

    if (command.includes("echo $!")) {
      this.lastPid += 1
      return { exitCode: 0, output: `${this.lastPid}\n` }
    }

    if (command.startsWith("cat ")) {
      const match = command.match(/cat "([^"]+)"/)
      const path = match ? match[1] : command.slice(4).trim().split(/\s/)[0].replace(/^'|'$/g, "")
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

  async executeBackground(opts: { command: string; outputFile: string; runId: string }): Promise<{ pid: number }> {
    this.lastPid += 1
    return { pid: this.lastPid }
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
    const outputFile = `${sessionDir}/0.jsonl`
    sandbox.setFile(
      `${sessionDir}/meta.json`,
      JSON.stringify({ currentTurn: 0, cursor: 0, pid: 1235, runId: "r1", outputFile })
    )
    const events: Event[] = [
      { type: "session", id: "sess-2" },
      { type: "token", text: "World" },
    ]
    sandbox.setFile(outputFile, events.map(e => JSON.stringify(e)).join("\n") + "\n")

    const res = await provider.getEventsSandboxBackgroundFromMeta(sessionDir)

    expect(res.events).toEqual(events)
    expect(res.cursor).toBe("2")
    expect(res.sessionId).toBe("sess-2")
    const metaJson = sandbox.getFile(`${sessionDir}/meta.json`)
    const meta = JSON.parse(metaJson!)
    expect(meta.cursor).toBe(2)
    expect(meta.runId).toBe("r1")
  })

  describe("isSandboxBackgroundProcessRunning (done file)", () => {
    it("returns true when runId/outputFile set and no .done file", async () => {
      const sandbox = new FakeSandbox()
      const provider = new TestProvider({ sandbox })
      await provider.ready
      const sessionDir = "/tmp/codeagent-test"
      const outputFile = `${sessionDir}/0.jsonl`
      sandbox.setFile(
        `${sessionDir}/meta.json`,
        JSON.stringify({ currentTurn: 0, cursor: 0, pid: 1235, runId: "r1", outputFile })
      )
      // no outputFile.done set => running
      const running = await provider.isSandboxBackgroundProcessRunning(sessionDir)
      expect(running).toBe(true)
    })

    it("returns false when .done file exists", async () => {
      const sandbox = new FakeSandbox()
      const provider = new TestProvider({ sandbox })
      await provider.ready
      const sessionDir = "/tmp/codeagent-test"
      const outputFile = `${sessionDir}/0.jsonl`
      sandbox.setFile(
        `${sessionDir}/meta.json`,
        JSON.stringify({ currentTurn: 0, cursor: 0, pid: 1235, runId: "r1", outputFile })
      )
      sandbox.setFile(outputFile + ".done", "1")
      const running = await provider.isSandboxBackgroundProcessRunning(sessionDir)
      expect(running).toBe(false)
    })

    it("returns false when no runId in meta", async () => {
      const sandbox = new FakeSandbox()
      const provider = new TestProvider({ sandbox })
      await provider.ready
      const sessionDir = "/tmp/codeagent-test"
      sandbox.setFile(
        `${sessionDir}/meta.json`,
        JSON.stringify({ currentTurn: 0, cursor: 0, pid: 1235 })
      )
      const running = await provider.isSandboxBackgroundProcessRunning(sessionDir)
      expect(running).toBe(false)
    })
  })

  describe("getEventsSandboxBackgroundFromMeta clears run on sawEnd", () => {
    it("clears pid/runId/outputFile when end event seen so getPid returns null and next getEvents is empty", async () => {
      const sandbox = new FakeSandbox()
      const provider = new TestProvider({ sandbox })
      await provider.ready
      const sessionDir = "/tmp/codeagent-test"
      const outputFile = `${sessionDir}/0.jsonl`
      sandbox.setFile(
        `${sessionDir}/meta.json`,
        JSON.stringify({ currentTurn: 0, cursor: 0, pid: 1235, runId: "r1", outputFile })
      )
      const eventsWithEnd: Event[] = [
        { type: "session", id: "sess-3" },
        { type: "token", text: "Hi" },
        { type: "end" },
      ]
      sandbox.setFile(outputFile, eventsWithEnd.map(e => JSON.stringify(e)).join("\n") + "\n")

      const res = await provider.getEventsSandboxBackgroundFromMeta(sessionDir)
      expect(res.events).toEqual(eventsWithEnd)
      expect(res.events.some(e => e.type === "end")).toBe(true)

      const pidAfter = await provider.getSandboxBackgroundPid(sessionDir)
      expect(pidAfter).toBeNull()

      const metaJson = sandbox.getFile(`${sessionDir}/meta.json`)
      const meta = JSON.parse(metaJson!)
      expect(meta.pid).toBeUndefined()
      expect(meta.runId).toBeUndefined()
      expect(meta.outputFile).toBeUndefined()
      expect(meta.currentTurn).toBe(1)

      const res2 = await provider.getEventsSandboxBackgroundFromMeta(sessionDir)
      expect(res2.events).toEqual([])
    })
  })
})

