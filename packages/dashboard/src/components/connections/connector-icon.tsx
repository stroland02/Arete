import {
  IconBrandGithub,
  IconChartHistogram,
  IconBug,
  IconTriangle,
  IconCreditCard,
} from "@tabler/icons-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "github-actions": IconBrandGithub,
  posthog: IconChartHistogram,
  sentry: IconBug,
  vercel: IconTriangle,
  stripe: IconCreditCard,
};

export function ConnectorIcon({ id, className }: { id: string; className?: string }) {
  const Icon = ICONS[id] ?? IconBrandGithub;
  return <Icon className={className} />;
}
