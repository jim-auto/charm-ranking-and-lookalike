import { useState } from 'react';

const weights = [
  { label: '黄金比', pct: 40, color: 'bg-amber-500', desc: '縦横比と配置' },
  { label: '目', pct: 20, color: 'bg-purple-500', desc: '目の形と開き' },
  { label: '鼻', pct: 20, color: 'bg-green-500', desc: '鼻の比率' },
  { label: '口', pct: 20, color: 'bg-pink-500', desc: '口元の比率' },
];

export default function ScoreBreakdown() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-10 border-t border-slate-800 pt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        スコアの計算方法
      </button>

      {open && (
        <div className="mt-4 space-y-6 text-sm text-slate-300">
          <section>
            <h3 className="mb-2 font-semibold text-white">顔スコア</h3>
            <p className="mb-3 text-slate-400">
              68点のランドマークから4指標を出しています。
              総合は各指標を偏差値に直してから重みづけしています。
            </p>
            <div className="space-y-2">
              {weights.map((weight) => (
                <div key={weight.label} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-right text-slate-400">{weight.pct}%</span>
                  <div className="flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-sm ${weight.color}`} />
                      <span className="text-white">{weight.label}</span>
                    </div>
                    <p className="ml-5 text-xs text-slate-500">{weight.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex h-3 gap-1 overflow-hidden rounded">
              {weights.map((weight) => (
                <div key={weight.label} className={weight.color} style={{ width: `${weight.pct}%` }} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-white">ランキング条件</h3>
            <p className="text-slate-400">
              デフォルトはU40です。全年代は切替で見られます。
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-white">SNS補正 ON</h3>
            <p className="text-slate-400">
              主要SNSのフォロワー数を対数で換算し、顔70%とSNS30%で混ぜています。
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-white">基準比率</h3>
            <ul className="ml-4 list-disc space-y-1 text-slate-400">
              <li>顔の縦横比: <span className="text-white">1.46</span></li>
              <li>目の距離 / 顔幅: <span className="text-white">0.44</span></li>
              <li>鼻幅 / 顔幅: <span className="text-white">0.26</span></li>
              <li>口幅 / 鼻幅: <span className="text-white">1.5</span></li>
              <li>目の縦横比: <span className="text-white">0.33</span></li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
