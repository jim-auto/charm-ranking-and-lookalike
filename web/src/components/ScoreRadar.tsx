import { Component, type ReactNode } from 'react';
import {
  Chart as ChartJS,
  Filler,
  LineElement,
  PointElement,
  RadialLinearScale,
  Tooltip,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import type { ScoreDetails } from '../types/celebrity';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip);

interface Props {
  details: ScoreDetails;
  size?: 'xs' | 'sm' | 'md';
}

const metricEntries: Array<{ label: string; key: keyof ScoreDetails }> = [
  { label: '黄金比', key: 'golden_ratio' },
  { label: '目', key: 'eyes' },
  { label: '鼻', key: 'nose' },
  { label: '口', key: 'mouth' },
  { label: '等身', key: 'body_proportion' },
];

class RadarErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function RadarChart({ details, size = 'md' }: Props) {
  const isCompact = size === 'xs';
  const isSmall = size === 'sm';
  const activeMetrics = metricEntries.filter(
    ({ key }) => typeof details[key] === 'number',
  );

  const data = {
    labels: activeMetrics.map(({ label }) => label),
    datasets: [
      {
        data: activeMetrics.map(({ key }) => details[key] ?? 0),
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        borderColor: 'rgba(99, 102, 241, 0.8)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(99, 102, 241, 1)',
        pointRadius: isCompact ? 1.5 : isSmall ? 2 : 3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: true,
    animation: false as const,
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        ticks: {
          stepSize: 20,
          color: '#94a3b8',
          backdropColor: 'transparent',
          display: !isCompact,
          font: { size: isCompact ? 0 : isSmall ? 8 : 10 },
        },
        pointLabels: {
          color: '#cbd5e1',
          font: { size: isCompact ? 8 : isSmall ? 9 : 12 },
        },
        grid: { color: 'rgba(148, 163, 184, 0.2)' },
        angleLines: { color: 'rgba(148, 163, 184, 0.2)' },
      },
    },
    plugins: { legend: { display: false } },
  };

  const wrapperClass =
    size === 'xs' ? 'h-24 w-24 sm:h-28 sm:w-28' : size === 'sm' ? 'h-32 w-32' : 'h-56 w-56';

  return (
    <div className={wrapperClass}>
      <Radar data={data} options={options} />
    </div>
  );
}

export default function ScoreRadar(props: Props) {
  return (
    <RadarErrorBoundary fallback={<div className="text-xs text-slate-500">チャート読み込みエラー</div>}>
      <RadarChart {...props} />
    </RadarErrorBoundary>
  );
}
