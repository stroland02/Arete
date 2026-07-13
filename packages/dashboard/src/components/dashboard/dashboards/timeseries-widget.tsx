import { bucketByDay } from "@/lib/trends";
import { Widget } from "./widget";
import type { ConnectKind } from "./connect-prompt";

export interface TimeseriesWidgetProps {
  title: string;
  caption?: string;
  dates: Date[];
  days: number;
  connect?: ConnectKind;
}

const W = 600;
const H = 160;

export function TimeseriesWidget({ title, caption, dates, days, connect }: TimeseriesWidgetProps) {
  if (connect) {
    return <Widget title={title} caption={caption} connect={connect}><span /></Widget>;
  }

  const series = bucketByDay(dates, days);
  const total = series.reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <Widget title={title} caption={caption} isEmpty emptyLabel="No activity in this range"><span /></Widget>
    );
  }

  const max = Math.max(...series, 1);
  const stepX = series.length > 1 ? W / (series.length - 1) : 0;
  const points = series.map((v, i) => {
    const x = i * stepX;
    const y = H - (v / max) * (H - 12) - 6;
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  return (
    <Widget title={title} caption={caption} action={<span className="font-mono text-xs text-content-muted">{total} total</span>}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`${title}: ${total} total`}>
        <polygon points={area} className="fill-accent-primary/10" />
        <polyline points={line} fill="none" className="stroke-accent-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Widget>
  );
}
