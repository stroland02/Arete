import { PageReveal, RevealItem } from "@/components/dashboard/page-reveal";

export default function McpKumaPage() {
  return (
    <PageReveal className="mx-auto max-w-3xl space-y-6">
      <RevealItem>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-content-primary">Connect MCP Kuma</h1>
          <p className="text-sm text-content-muted">
            Pull Kuma&apos;s review judgment straight into your coding agent using the Model Context Protocol.
          </p>
        </div>
      </RevealItem>
      <RevealItem>
        <div className="glass-panel p-6">
          <p className="text-sm text-content-primary">
            Add the following configuration to your agent&apos;s MCP settings (e.g., <code>cline_mcp_settings.json</code>):
          </p>
          <div className="mt-4 rounded-xl border border-border-subtle bg-surface-2 p-4 font-mono text-xs text-content-secondary">
            <pre>
{`{
  "mcpServers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@arete/mcp-server-kuma"]
    }
  }
}`}
            </pre>
          </div>
        </div>
      </RevealItem>
    </PageReveal>
  );
}
