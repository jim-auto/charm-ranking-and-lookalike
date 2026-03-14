import { useState } from 'react';

const weights = [
  { label: '黄金比', pct: 35, color: 'bg-amber-500', desc: '顔の縦横比・目の間隔が理想比率にどれだけ近いか' },
  { label: '目', pct: 15, color: 'bg-purple-500', desc: '目の開き具合・左右バランス' },
  { label: '鼻', pct: 15, color: 'bg-green-500', desc: '鼻の幅と長さの比率' },
  { label: '口', pct: 15, color: 'bg-pink-500', desc: '口幅と唇の上下比率' },
  { label: '輪郭', pct: 20, color: 'bg-cyan-500', desc: '顎ラインの滑らかさ' },
];

export default function ScoreBreakdown() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-10 border-t border-slate-800 pt-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        スコアの算出方法
      </button>

      {open && (
        <div className="mt-4 space-y-6 text-sm text-slate-300">
          <section>
            <h3 className="text-white font-semibold mb-2">顔スコア（基本）</h3>
            <p className="text-slate-400 mb-3">
              顔の68点ランドマークを検出し、各パーツの比率を数学的に評価。
              日本人の顔に最適化した理想比率と比較してスコア化しています。
            </p>
            <div className="space-y-2">
              {weights.map((w) => (
                <div key={w.label} className="flex items-center gap-3">
                  <span className="w-12 text-right text-slate-400 shrink-0">{w.pct}%</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <div className={`w-3 h-3 rounded-sm ${w.color}`} />
                      <span className="text-white">{w.label}</span>
                    </div>
                    <p className="text-xs text-slate-500 ml-5">{w.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-1 h-3 rounded overflow-hidden">
              {weights.map((w) => (
                <div key={w.label} className={`${w.color}`} style={{ width: `${w.pct}%` }} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">年齢補正（ON/OFF）</h3>
            <p className="text-slate-400">
              23歳をピークとし、年齢差に応じてスコアを加減算。
              ±3歳以内は+2〜+5点のボーナス、それ以上離れると減点されます。
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">SNS影響力（ON/OFF）</h3>
            <p className="text-slate-400">
              Instagram / X / TikTok / YouTube のフォロワー数合計を対数スケールで評価。
              顔スコア 70% + SNSボーナス込みスコア 30% で算出します。
            </p>
          </section>

          <section>
            <h3 className="text-white font-semibold mb-2">理想比率（日本人向け）</h3>
            <ul className="text-slate-400 space-y-1 ml-4 list-disc">
              <li>顔の縦横比: <span className="text-white">1.46</span>（西洋の黄金比1.618より短め）</li>
              <li>目の間隔 / 顔幅: <span className="text-white">0.44</span></li>
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
