import { Suspense, lazy } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';

const RankingPage = lazy(() => import('./pages/RankingPage'));
const DiagnosePage = lazy(() => import('./pages/DiagnosePage'));

function PageFallback() {
  return (
    <div className="py-12 text-center text-slate-400">
      <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
      読み込み中...
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen">
        <header className="border-b border-slate-800">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <h1 className="text-base font-bold text-white sm:text-xl">外見ランキング</h1>
            <nav className="flex gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                ランキング
              </NavLink>
              <NavLink
                to="/diagnose"
                className={({ isActive }) =>
                  `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                  }`
                }
              >
                AI外見診断
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-8">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<RankingPage />} />
              <Route path="/diagnose" element={<DiagnosePage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </HashRouter>
  );
}
