// Per-provider (not per-installation) circuit breaker: a provider-wide
// outage affects every installation using that provider at once, so
// tripping the breaker per-provider prevents piling up slow/hung requests
// across every customer's reviews simultaneously during an outage.

const FAILURE_THRESHOLD = 5
const COOLDOWN_MS = 5 * 60 * 1000

interface ProviderState {
  consecutiveFailures: number
  openedAt: number | null
}

const state = new Map<string, ProviderState>()

function getState(provider: string): ProviderState {
  let s = state.get(provider)
  if (!s) {
    s = { consecutiveFailures: 0, openedAt: null }
    state.set(provider, s)
  }
  return s
}

export function recordTelemetryFailure(provider: string): void {
  const s = getState(provider)
  s.consecutiveFailures += 1
  if (s.consecutiveFailures >= FAILURE_THRESHOLD && s.openedAt === null) {
    s.openedAt = Date.now()
  }
}

export function recordTelemetrySuccess(provider: string): void {
  const s = getState(provider)
  s.consecutiveFailures = 0
  s.openedAt = null
}

export function isTelemetryCircuitOpen(provider: string): boolean {
  const s = getState(provider)
  if (s.openedAt === null) return false
  if (Date.now() - s.openedAt >= COOLDOWN_MS) {
    // Cooldown elapsed — close the circuit and give the provider another chance.
    s.consecutiveFailures = 0
    s.openedAt = null
    return false
  }
  return true
}
