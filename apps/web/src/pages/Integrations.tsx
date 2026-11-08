import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, can, fmt, useApi } from '../lib';
import { Badge, Button, Card, ErrorBox, Field, inputCls, Loading, PageHeader, PlatformTag, Table } from '../components/ui';
import { useMe } from '../main';

const HEALTH: Record<string, { c: any; t: string }> = {
  healthy: { c: 'green', t: '✓ Healthy' }, partial: { c: 'amber', t: '◐ Partial (some metrics unavailable)' }, stale: { c: 'amber', t: '⚠ Stale' },
  never_synced: { c: 'gray', t: 'Waiting for first sync' }, token_expired: { c: 'red', t: '✕ Reconnect required' }, error: { c: 'red', t: '✕ Error' }, demo: { c: 'amber', t: 'DEMO' },
};

export default function Integrations() {
  const me = useMe();
  const [params] = useSearchParams();
  const { data, reload } = useApi<any>('/api/integrations');
  const health = useApi<any>('/api/system/health').data;
  const studio = useApi<any>('/api/studio/status').data;
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(params.get('error'));
  const [logs, setLogs] = useState<{ id: string; rows: any[] } | null>(null);
  const manage = can(me, 'integrations.manage');
  const sync = can(me, 'sync.run', 'integrations.manage');
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader title="Integrations" subtitle="Connected accounts, connection health and synchronisation"
        actions={sync && <Button onClick={async () => { await api('/api/integrations/sync-all', { method: 'POST' }); setMsg('Sync queued for all accounts.'); }}>Sync all now</Button>} />
      {params.get('connected') && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3 text-sm mb-4">Connected: {params.get('connected')}. The first (backfill) sync is running.</div>}
      <ErrorBox error={err} />
      {msg && <div className="text-sm text-ink-2 mb-3">{msg}</div>}
      <div className="space-y-5">
        <Card title="Connected accounts">
          <Table rows={data.accounts} empty="No accounts connected yet" columns={[
            { key: 'p', label: 'Platform', render: (r) => <PlatformTag code={r.platform_code} /> },
            { key: 'display_name', label: 'Account', render: (r) => <>{r.display_name}{r.handle && <span className="text-ink-3"> @{r.handle}</span>}</> },
            { key: 'health', label: 'Connection', render: (r) => <Badge color={HEALTH[r.health]?.c}>{HEALTH[r.health]?.t ?? r.health}</Badge> },
            { key: 'last_synced_at', label: 'Last synchronised', render: (r) => <span title={fmt.dt(r.last_synced_at)}>{fmt.ago(r.last_synced_at)}</span> },
            { key: 'publications', label: 'Posts', align: 'right' },
            { key: 'token_expires_at', label: 'Token', render: (r) => (r.token_expires_at ? <span className="text-xs">expires {fmt.date(r.token_expires_at)}</span> : <span className="text-xs text-ink-3">no expiry</span>) },
            { key: 'last_error', label: 'Last error', render: (r) => <span className="text-xs text-red-700">{r.last_error ?? ''}</span> },
            { key: 'a', label: '', render: (r) => r.data_origin === 'live' && <div className="flex gap-1">
              {sync && <Button small onClick={async () => { await api(`/api/integrations/${r.id}/sync`, { method: 'POST' }); setMsg(`Sync queued for ${r.display_name}`); setTimeout(reload, 4000); }}>Sync</Button>}
              {sync && <Button small onClick={async () => setLogs({ id: r.id, rows: await api(`/api/integrations/${r.id}/logs`) })}>Logs</Button>}
              {manage && <Button small variant="danger" onClick={async () => { if (confirm(`Disconnect ${r.display_name}? Historical data is kept.`)) { await api(`/api/integrations/${r.id}`, { method: 'DELETE' }); reload(); } }}>Disconnect</Button>}
            </div> },
          ]} />
          {logs && <div className="mt-4 border-t border-stone-100 pt-3"><div className="flex justify-between mb-2"><span className="text-sm font-medium">Integration log</span><Button small variant="ghost" onClick={() => setLogs(null)}>Close</Button></div>
            <Table rows={logs.rows} columns={[{ key: 'created_at', label: 'Time', render: (r) => fmt.dt(r.created_at) }, { key: 'level', label: 'Level', render: (r) => <Badge color={r.level === 'error' ? 'red' : r.level === 'warn' ? 'amber' : 'gray'}>{r.level}</Badge> }, { key: 'message', label: 'Message', render: (r) => <span className="text-xs">{r.message}</span> }, { key: 'http_status', label: 'HTTP' }]} /></div>}
        </Card>

        {manage && (
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="Facebook + Instagram (Meta)" subtitle="Connects every Facebook Page you manage and the Instagram professional account linked to each Page">
              {!data.configured.meta ? <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">Add <code>META_APP_ID</code> and <code>META_APP_SECRET</code> to <code>.env</code> and restart the API. See <em>docs/SETUP_API_KEYS.md</em>.</div> : <>
                <Button variant="primary" href="/api/integrations/meta/start">Connect with Facebook</Button>
                <div className="mt-5 border-t border-stone-100 pt-4">
                  <Field label="Or paste a User access token (Graph API Explorer)" hint="It is exchanged for a long-lived token, then Page tokens that do not expire."><textarea className={`${inputCls} h-20 font-mono text-xs`} value={token} onChange={(e) => setToken(e.target.value)} /></Field>
                  <div className="mt-2"><Button disabled={token.length < 20} onClick={async () => { setErr(null); try { const r = await api('/api/integrations/meta/token', { body: { access_token: token.trim() } }); setMsg(`Connected: ${r.connected.map((c: any) => `${c.platform} ${c.name}`).join(', ')}`); setToken(''); reload(); } catch (e) { setErr((e as Error).message); } }}>Connect with token</Button></div>
                </div></>}
              <div className="text-[11px] text-ink-3 mt-3">Redirect URI to register in the Meta app: <code>{data.redirect_uris.meta}</code></div>
            </Card>
            <Card title="YouTube (Google)" subtitle="Sign in with the Google account that owns or manages the YouTube channel">
              {!data.configured.google ? <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to <code>.env</code> and restart the API. See <em>docs/SETUP_API_KEYS.md</em>.</div>
                : <Button variant="primary" href="/api/integrations/google/start">Connect with Google</Button>}
              <div className="text-[11px] text-ink-3 mt-3">Authorised redirect URI in Google Cloud: <code>{data.redirect_uris.google}</code></div>
            </Card>
          </div>
        )}

        {manage && (
          <Card title="Content Studio: Google Drive" subtitle="Footage, pictures and reference videos are kept in Drive so Claude can reach them, and finished videos are picked up from content_final. Can be a different Google account from the YouTube channel.">
            {studio?.workspace ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge color={studio.workspace.status === 'connected' ? 'green' : 'red'}>{studio.workspace.status === 'connected' ? '✓ Connected' : '✕ Reconnect required'}</Badge>
                <span>{studio.workspace.email}</span>
                {studio.workspace.folders?.root && <a className="underline text-xs" target="_blank" href={`https://drive.google.com/drive/folders/${studio.workspace.folders.root}`}>Open "Content Studio" folder</a>}
                <span className="text-xs text-ink-3">Last Drive check {fmt.ago(studio.workspace.last_scan_at)}</span>
                <Button small onClick={async () => { const r = await api('/api/studio/drive/scan', { method: 'POST' }); const found = [...(r.raw?.created ?? []), ...(r.final?.linked ?? []), ...(r.final?.imported ?? [])]; setMsg(found.length ? `Found in Drive: ${found.join(', ')}` : 'Drive checked: nothing new in content_raw or content_final.'); }}>Check Drive now</Button>
                <Button small variant="primary" href="/api/integrations/workspace/start">Reconnect</Button>
                <Button small variant="danger" onClick={async () => { if (confirm('Disconnect Google Drive?')) { await api('/api/integrations/workspace', { method: 'DELETE' }); location.reload(); } }}>Disconnect</Button>
                {studio.workspace.last_error && <div className="w-full text-xs text-red-700">{studio.workspace.last_error}</div>}
              </div>
            ) : !data.configured.google ? <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to <code>.env</code> first (same Google Cloud project as YouTube).</div>
              : <><Button variant="primary" href="/api/integrations/workspace/start">Connect Google Drive</Button>
                <div className="text-xs text-ink-2 mt-2">Uses your folders <b>content_raw</b> and <b>content_final</b> in My Drive when they exist; otherwise creates <b>Content Studio</b> with content_raw, content_midway (one folder per video), suggestions, content_final and _assets (brand kit, music, reference videos, machines).</div></>}
            <div className="text-[11px] text-ink-3 mt-3">Authorised redirect URI to add in Google Cloud: <code>{data.redirect_uris.google.replace('/google/callback', '/workspace/callback')}</code></div>
          </Card>
        )}

        <Card title="Platform capabilities" subtitle="What each platform's official API actually provides — unavailable metrics are shown as unavailable, never as zero">
          <Table rows={data.platforms.filter((p: any) => p.kind === 'social')} columns={[
            { key: 'name', label: 'Platform', render: (r) => <PlatformTag code={r.code} /> },
            { key: 'en', label: 'Status', render: (r) => (r.is_enabled ? <Badge color="green">active</Badge> : <Badge>future — architecture ready</Badge>) },
            { key: 'rc', label: 'Retention curve', render: (r) => (r.capabilities.retention_curve ? 'Yes' : 'No') },
            { key: 'im', label: 'Impressions', render: (r) => (r.capabilities.impressions ? `Yes${r.capabilities.impressions_via ? ` (${r.capabilities.impressions_via.replace('_', ' ')})` : ''}` : 'No (deprecated / not exposed)') },
            { key: 'wt', label: 'Avg watch time', render: (r) => (r.capabilities.avg_watch_time ? 'Yes' : '—') },
          ]} />
        </Card>

        {health && <Card title="System health"><div className="flex flex-wrap gap-2 text-xs">
          <Badge color={health.db ? 'green' : 'red'}>Database {health.db ? 'ok' : 'down'}</Badge>
          <Badge color={health.analyzer?.ok ? 'green' : 'red'}>Video analyzer {health.analyzer?.ok ? 'ok' : 'unreachable'}</Badge>
          {health.analyzer?.ok && <><Badge color={health.analyzer.whisper ? 'green' : 'amber'}>Speech-to-text {health.analyzer.whisper ? `whisper (${health.analyzer.whisper_model})` : 'not installed'}</Badge><Badge color={health.analyzer.ocr ? 'green' : 'gray'}>OCR {health.analyzer.ocr ? 'on' : 'off'}</Badge></>}
          <Badge>{health.redis}</Badge>
        </div></Card>}
      </div>
    </>
  );
}
