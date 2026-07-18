const TONE_BG: Record<string, string> = {
  danger: "bg-accent-danger",
  warning: "bg-accent-warning",
  info: "bg-accent-info",
  success: "bg-accent-success",
};

/** Maps a risk word to a semantic tone (kept separate from the brand accent). */
export function severityTone(risk: string): "danger" | "warning" | "info" | "success" {
  switch (risk.toLowerCase()) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "success";
    default:
      return "info";
  }
}

/** A 2px severity bar for the leading edge of a table row / card. */
export function SeverityStripe({ risk }: { risk: string }) {
  return <span className={`w-0.5 shrink-0 self-stretch rounded-full ${TONE_BG[severityTone(risk)]}`} aria-hidden />;
}
