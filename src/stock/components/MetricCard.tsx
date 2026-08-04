import { memo } from "react";

type MetricCardProps = {
  className?: string;
  label: string;
  value: string;
};

function MetricCard({ className = "", label, value }: MetricCardProps) {
  return <div className={`stock-metric ${className}`.trim()}><span>{label}</span><strong>{value}</strong></div>;
}

export default memo(MetricCard);
