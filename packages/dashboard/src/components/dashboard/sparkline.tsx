interface SparklineProps {
  data: number[];
  className?: string;
  strokeClassName?: string;
}

export function Sparkline({ data, className, strokeClassName = "stroke-accent-primary" }: SparklineProps) {
  const width = 80;
  const height = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = data.length > 1 ? (index / (data.length - 1)) * width : width / 2;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        className={strokeClassName}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
