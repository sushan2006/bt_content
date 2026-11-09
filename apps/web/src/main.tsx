import React, { createContext, useContext, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import './index.css';
import { api, can, Me, setOrigin, useOrigin } from './lib';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Platform from './pages/Platform';
import ContentLibrary from './pages/ContentLibrary';
import ContentDetail from './pages/ContentDetail';
import PublicationDetail from './pages/PublicationDetail';
import Insights from './pages/Insights';
import Recommendations from './pages/Recommendations';
import Integrations from './pages/Integrations';
import Settings from './pages/Settings';
import Audit from './pages/Audit';
import StudioHome from './pages/studio/StudioHome';
import StudioNew from './pages/studio/StudioNew';
import StudioJob from './pages/studio/StudioJob';
import StudioSettings from './pages/studio/StudioSettings';
import StudioStyles from './pages/studio/StudioStyles';
import StudioCompleted from './pages/studio/StudioCompleted';

const MeCtx = createContext<{ me: Me | null; setMe: (m: Me | null) => void }>({ me: null, setMe: () => {} });
export const useMe = () => useContext(MeCtx).me;

const NAV: { to: string; label: string; perm: string; dot?: string; section?: string }[] = [
  { to: '/studio', label: 'Studio dashboard', perm: 'studio.view', section: 'Content Studio' },
  { to: '/studio/new', label: 'New video', perm: 'studio.manage' },
  { to: '/studio/completed', label: 'Completed videos', perm: 'studio.view' },
  { to: '/studio/styles', label: 'Styles & music', perm: 'studio.view' },
  { to: '/studio/settings', label: 'Studio settings', perm: 'settings.manage|studio.manage' },
  { to: '/', label: 'Overview', perm: 'analytics.view', section: 'Analytics' },
  { to: '/platform/instagram', label: 'Instagram', perm: 'analytics.view', dot: '#2a78d6' },
  { to: '/platform/facebook', label: 'Facebook', perm: 'analytics.view', dot: '#eb6834' },
  { to: '/platform/youtube', label: 'YouTube', perm: 'analytics.view', dot: '#1baf7a' },
  { to: '/content', label: 'Content library', perm: 'content.view_all|content.view_assigned' },
  { to: '/insights', label: 'Findings', perm: 'insights.view' },
  { to: '/recommendations', label: 'Recommendations', perm: 'insights.view' },
  { to: '/integrations', label: 'Integrations', perm: 'integrations.manage|analytics.view', section: 'Setup' },
  { to: '/settings', label: 'Settings', perm: 'users.manage|settings.manage' },
  { to: '/audit', label: 'Audit & Activity', perm: 'audit.view' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, setMe } = useContext(MeCtx);
  const origin = useOrigin();
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-stone-200 bg-white flex flex-col sticky top-0 h-screen self-start">
        <div className="px-5 py-5 border-b border-stone-100">
          <div className="text-[15px] font-semibold text-ink leading-tight">Content Intelligence</div>
          <div className="text-[11px] text-ink-3">Studio · social analytics · AI insights</div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.filter((n) => can(me, ...n.perm.split('|'))).map((n) => (<div key={n.to}>
            {n.section && <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-ink-3 font-semibold">{n.section}</div>}
            <NavLink to={n.to} end={n.to === '/' || n.to === '/studio'} className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${isActive ? 'bg-stone-100 text-ink font-medium' : 'text-ink-2 hover:bg-stone-50 hover:text-ink'}`}>
              {n.dot ? <span className="w-2 h-2 rounded-full" style={{ background: n.dot }} /> : <span className="w-2" />}{n.label}
            </NavLink></div>
          ))}
        </nav>
        <div className="p-3 border-t border-stone-100 text-xs">
          <div className="text-ink font-medium truncate">{me?.full_name}</div>
          <div className="text-ink-3">{me?.role === 'admin' ? 'Admin' : 'Viewer'}</div>
          <button className="text-ink-2 hover:text-ink mt-2" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); setMe(null); nav('/login'); }}>Sign out</button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="flex items-center justify-end gap-3 px-8 py-3 border-b border-stone-200 bg-white">
          <span className="text-xs text-ink-2">Data</span>
          <div className="inline-flex rounded-lg border border-stone-300 overflow-hidden text-xs">
            {(['live', 'demo'] as const).map((o) => (
              <button key={o} onClick={() => setOrigin(o)} className={`px-3 py-1.5 ${origin === o ? (o === 'demo' ? 'bg-amber-500 text-white' : 'bg-ink text-white') : 'bg-white text-ink-2'}`}>{o === 'live' ? 'Live company data' : 'Demo data'}</button>
            ))}
          </div>
        </div>
        {origin === 'demo' && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-8 py-2">
            <strong>DEMO DATA</strong> — synthetic records for testing the interface and the analysis engine. These numbers are <strong>not</strong> your company's analytics.
          </div>
        )}
        <div className="px-8 py-6 max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { api<{ user: Me }>('/api/auth/me').then((r) => setMe(r.user)).catch(() => setMe(null)).finally(() => setReady(true)); }, []);
  if (!ready) return null;
  const guarded = (el: React.ReactNode) => (me ? <Shell>{el}</Shell> : <Navigate to="/login" replace />);
  return (
    <MeCtx.Provider value={{ me, setMe }}>
      <Routes>
        <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login onLogin={setMe} />} />
        <Route path="/" element={guarded(<Overview />)} />
        <Route path="/platform/:code" element={guarded(<Platform />)} />
        <Route path="/content" element={guarded(<ContentLibrary />)} />
        <Route path="/content/:id" element={guarded(<ContentDetail />)} />
        <Route path="/publication/:id" element={guarded(<PublicationDetail />)} />
        <Route path="/publications" element={<Navigate to="/content" replace />} />
        <Route path="/insights" element={guarded(<Insights />)} />
        <Route path="/brief" element={<Navigate to="/" replace />} />
        <Route path="/recommendations" element={guarded(<Recommendations />)} />
        <Route path="/integrations" element={guarded(<Integrations />)} />
        <Route path="/settings" element={guarded(<Settings />)} />
        <Route path="/audit" element={guarded(<Audit />)} />
        <Route path="/studio" element={guarded(<StudioHome />)} />
        <Route path="/studio/new" element={guarded(<StudioNew />)} />
        <Route path="/studio/music" element={<Navigate to="/studio/styles?tab=music" replace />} />
        <Route path="/studio/settings" element={guarded(<StudioSettings />)} />
        <Route path="/studio/styles" element={guarded(<StudioStyles />)} />
        <Route path="/studio/machines" element={<Navigate to="/studio/new" replace />} />
        <Route path="/studio/completed" element={guarded(<StudioCompleted />)} />
        <Route path="/studio/:id" element={guarded(<StudioJob />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MeCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
