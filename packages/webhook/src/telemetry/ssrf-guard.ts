// Customer .arete.yml config never supplies a raw URL for a telemetry
// connector — only a provider name and a service/project identifier (see
// pr-fetcher.ts's telemetry_connectors parsing). This guard exists as a
// defense-in-depth check on the URLs the connectors themselves construct,
// so a bug in a connector can never turn into a request to an arbitrary or
// internal host.

const ALLOWED_HOSTS: Record<'github_actions' | 'posthog', string[]> = {
  github_actions: ['api.github.com'],
  posthog: ['app.posthog.com', 'us.posthog.com', 'eu.posthog.com'],
}

const PRIVATE_IPV4_PREFIXES = ['10.', '127.', '169.254.', '192.168.']

function isPrivateOrMetadataIPv4(hostname: string): boolean {
  if (PRIVATE_IPV4_PREFIXES.some((prefix) => hostname.startsWith(prefix))) return true
  // 172.16.0.0 - 172.31.255.255
  const match = hostname.match(/^172\.(\d+)\./)
  if (match) {
    const second = Number(match[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

export function assertAllowedTelemetryHost(provider: 'github_actions' | 'posthog', url: string): void {
  const parsed = new URL(url)
  if (isPrivateOrMetadataIPv4(parsed.hostname) || parsed.hostname === 'localhost') {
    throw new Error(`Telemetry connector blocked: "${parsed.hostname}" resolves to a private/internal address`)
  }
  const allowed = ALLOWED_HOSTS[provider]
  if (!allowed.includes(parsed.hostname)) {
    throw new Error(`Telemetry connector blocked: "${parsed.hostname}" is not an allowed host for provider "${provider}"`)
  }
}
