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

const labels = ['対称性', '黄金比', '目', '鼻', '口', '輪郭', '肌'];
const keys: (keyof ScoreDetails)[] = [
  'symmetry', 'golden_ratio', 'eyes', 'nose', 'mouth', 'contour', 'skin',
];

export default function ScoreRadar({ details, size = 'md' }: Props) {
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
