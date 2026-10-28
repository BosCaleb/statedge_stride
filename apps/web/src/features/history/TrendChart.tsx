import { formatDisplayDate } from '@stride/shared/dates';
import type { Confidence } from '@stride/shared/enums';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { strings } from '../../lib/strings';
import styles from './history.module.css';

// One metric across the athlete's sessions. Low-confidence points are drawn hollow, and the
// tooltip names the confidence of each value. Loaded on its own, so the chart library stays out
// of the screens that do not show a chart.

export interface TrendPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
  label: string;
  confidence: Confidence;
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  const point = payload?.[0]?.payload as TrendPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className={styles.tooltip}>
      <p>{formatDisplayDate(point.date)}</p>
      <p className={styles.tooltipValue}>{point.label}</p>
      <p>{strings.metrics.confidence[point.confidence]}</p>
    </div>
  );
}

export function TrendChart({ points, title }: { points: TrendPoint[]; title: string }) {
  return (
    <div className={styles.chart} role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => formatDisplayDate(d)}
            stroke="var(--text-muted)"
            fontSize={12}
          />
          <YAxis stroke="var(--text-muted)" fontSize={12} width={48} domain={['auto', 'auto']} />
          <Tooltip content={(p) => <TrendTooltip active={p.active} payload={p.payload} />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--secondary)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: TrendPoint }) => (
              <circle
                key={props.index}
                cx={props.cx}
                cy={props.cy}
                r={5}
                stroke="var(--secondary)"
                strokeWidth={2}
                fill={
                  props.payload?.confidence === 'low' ? 'var(--surface-raised)' : 'var(--secondary)'
                }
              />
            )}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
