import { useState } from 'react';

const weights = [
  { label: '黄金比', pct: 35, color: 'bg-amber-500', desc: '顔の縦横比や目の配置が理想比率に近いか' },
  { label: '目', pct: 15, color: 'bg-purple-500', desc: '目の開き方と左右バランス' },
  { label: '鼻', pct: 15, color: 'bg-green-500', desc: '鼻の幅と長さの比率' },
  { label: '口', pct: 15, color: 'bg-pink-500', desc: '口幅と唇バランスの比率' },
  { label: '輪郭', pct: 20, color: 'bg-cyan-500', desc: 'フェイスラインの滑らかさ' },
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
              顔の68ランドマークから、構造に寄った5指標を計算しています。
              総合順位では各指標をデータ全体の分布で標準化してから重みづけして、極端に圧縮された指標が効きすぎないようにしています。
              左右対称は参考値として保持していますが、角度や表情の影響が大きいため総合順位の重みには入れていません。
            </p>
            <div className="space-y-2">
              {weights.map((w) => (
                <div key={w.label} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-right text-slate-400">{w.pct}%</span>
                  <div className="flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-sm ${w.color}`} />
                      <span className="text-white">{w.label}</span>
                    </div>
                    <p className="ml-5 text-xs text-slate-500">{w.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex h-3 gap-1 overflow-hidden rounded">
              {weights.map((w) => (
                <div key={w.label} className={w.color} style={{ width: `${w.pct}%` }} />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              鼻・輪郭・左右対称は写真条件の影響が残りやすいので、個別ランキングでは参考値として見てください。
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-white">年齢補正 ON</h3>
            <p className="text-slate-400">
              23歳をピークにして加点し、そこから離れるほど減点します。
              20代前半は最大で +5、30代以降は段階的に下がり、40代以上は補正込みランキングで上位に残りにくい設定です。
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-white">SNS補正 ON</h3>
            <p className="text-slate-400">
              Instagram / X / TikTok / YouTube の総フォロワー数を対数スケールで換算します。
              顔スコア70%とSNSスコア30%を合成しています。
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
