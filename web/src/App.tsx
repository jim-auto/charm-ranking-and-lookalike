import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import RankingPage from './pages/RankingPage';
import DiagnosePage from './pages/DiagnosePage';

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen">
        <header className="border-b border-slate-800">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <h1 className="text-base sm:text-xl font-bold text-white">
              顔面偏差値ランキング
            </h1>
            <nav className="flex gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                ランキング
              </NavLink>
              <NavLink
                to="/diagnose"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                診断する
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<RankingPage />} />
            <Route path="/diagnose" element={<DiagnosePage />} />
          </Routes>
        </main>

        <footer className="border-t border-slate-800 py-6 text-center text-sm text-slate-500">
          <p>偏差値は顔の数学的比率に基づく指標であり、美の絶対評価ではありません。</p>
        </footer>
      </div>
    </HashRouter>
  );
}
