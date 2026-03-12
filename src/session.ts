import type { ProviderName, ProviderOptions, RunDefaults } from "./types/index.js"
import { createProvider } from "./factory.js"
import type { Provider } from "./providers/base.js"

/** Options for createSession (provider options + run defaults like model, timeout). */
export interface SessionOptions extends ProviderOptions {
  model?: string
  sessionId?: string
  timeout?: number
  skipInstall?: boolean
  env?: Record<string, string>
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
