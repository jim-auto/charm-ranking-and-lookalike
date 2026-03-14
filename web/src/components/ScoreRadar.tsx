import { Component, type ReactNode } from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import type { ScoreDetails } from '../types/celebrity';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip);

interface Props {
  details: ScoreDetails;
  size?: 'sm' | 'md';
}

const labels = ['黄金比', '目', '鼻', '口', '輪郭'];
const keys: (keyof ScoreDetails)[] = [
  'golden_ratio', 'eyes', 'nose', 'mouth', 'contour',
];

class RadarErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

function RadarChart({ details, size = 'md' }: Props) {
  const data = {
    labels,
    datasets: [
      {
        data: keys.map((k) => details[k]),
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        borderColor: 'rgba(99, 102, 241, 0.8)',
        borderWidth: 2,
        pointBackgroundColor: 'rgba(99, 102, 241, 1)',
        pointRadius: size === 'sm' ? 2 : 3,
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
          font: { size: size === 'sm' ? 8 : 10 },
        },
        pointLabels: {
          color: '#cbd5e1',
          font: { size: size === 'sm' ? 9 : 12 },
        },
        grid: { color: 'rgba(148, 163, 184, 0.2)' },
        angleLines: { color: 'rgba(148, 163, 184, 0.2)' },
      },
    },
    plugins: { legend: { display: false } },
  };

  const wrapperClass = size === 'sm' ? 'w-32 h-32' : 'w-56 h-56';

  return (
    <div className={wrapperClass}>
      <Radar data={data} options={options} />
    </div>
  );
}

export default function ScoreRadar(props: Props) {
  return (
    <RadarErrorBoundary fallback={<div className="text-xs text-slate-500">チャート読込エラー</div>}>
      <RadarChart {...props} />
    </RadarErrorBoundary>
  );
}
