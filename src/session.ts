import { randomUUID } from "node:crypto"
import type { ProviderName, ProviderOptions, RunDefaults, RunOptions, Event } from "./types/index.js"
import { createProvider } from "./factory.js"
import type { Provider } from "./providers/base.js"

const CODEAGENT_SESSION_DIR_PREFIX = "/tmp/codeagent-"

/** Options for createSession (provider options + run defaults like model, timeout). */
export interface SessionOptions extends ProviderOptions {
  model?: string
  sessionId?: string
  timeout?: number
  skipInstall?: boolean
  env?: Record<string, string>
}

/** Options for createBackgroundSession (session options; outputFile is derived from session id). */
export interface BackgroundSessionOptions extends SessionOptions {}

/** Background session handle: start turns and get events; state lives in sandbox under session id. */
export interface BackgroundSession {
  /** Unique session id; paths and cursor in sandbox are derived from this. */
  readonly id: string
  /** Underlying provider instance (advanced use only). */
  readonly provider: Provider

  /**
   * Start a new turn with the given prompt. One log file per turn in the sandbox.
   */
  start(prompt: string, options?: Omit<RunOptions, "prompt">): Promise<{
    executionId: string
    pid: number
    outputFile: string
  }>

  /**
   * Get new events for the current turn. Cursor is read/updated in sandbox meta; no arguments.
   */
  getEvents(): Promise<{
    status: "running" | "completed"
    sessionId: string | null
    events: Event[]
    cursor: string
  }>
}

/**
 * Create a session: a provider with run defaults (model, timeout, env) set at creation.
 * Returns the provider; call session.run(prompt) with just the prompt string.
 */
export async function createSession(name: ProviderName, options: SessionOptions): Promise<Provider> {
  const { model, sessionId, timeout, skipInstall, env, ...providerOptions } = options
  const runDefaults: RunDefaults = { model, sessionId, timeout, skipInstall, env }
  const provider = createProvider(name, { ...providerOptions, skipInstall, env, runDefaults })
  await provider.ready
  return provider
}

/**
 * Create a background session: a provider configured for sandboxed background
 * execution with one log file per turn and meta/cursor in the sandbox.
 * Use start() to begin a turn and getEvents() to consume events (no cursor argument).
 */
export async function createBackgroundSession(
  name: ProviderName,
  options: BackgroundSessionOptions
): Promise<BackgroundSession> {
  const id = randomUUID()
  const provider = await createSession(name, options)
  const sessionDir = `${CODEAGENT_SESSION_DIR_PREFIX}${id}`

  return {
    id,
    provider,
    async start(prompt: string, extraOptions?: Omit<RunOptions, "prompt">) {
      return provider.startSandboxBackgroundTurn(sessionDir, {
        ...(extraOptions ?? {}),
        prompt,
      })
    },
    async getEvents() {
      return provider.getEventsSandboxBackgroundFromMeta(sessionDir)
    },
  }
}
