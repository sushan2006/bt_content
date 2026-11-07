import { useEffect, useState } from 'react';
import { api, useApi } from '../../lib';
import { Button, Card, ErrorBox, Field, inputCls, Loading, PageHeader } from '../../components/ui';
import { listInput, StylePicker } from './common';

const COLOR_ROLES: [string, string][] = [['primary', 'Main colour'], ['accent', 'Highlight colour'], ['alert', 'Alert colour'], ['dark', 'Dark background'], ['darker', 'Darkest background']];

export default function StudioSettings() {
  const { data, reload } = useApi<any>('/api/studio/settings');
  const styles = useApi<any[]>('/api/studio/styles').data ?? [];
  const status = useApi<any>('/api/studio/status').data;
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logoV, setLogoV] = useState(Date.now());
  useEffect(() => { if (data) setS({ ...data, suggestion_text: (data.suggestion_emails ?? []).join(', '), approver_text: (data.approver_emails ?? []).join(', '), glossary_text: (data.glossary ?? []).join(', ') }); }, [data]);
  if (!s) return <Loading />;
  const b = s.brand ?? {};
  const setB = (k: string, v: any) => setS({ ...s, brand: { ...b, [k]: v } });
  const dr = s.director ?? {};
  const setD = (k: string, v: any) => setS({ ...s, director: { ...dr, [k]: v } });
  const keyOk = status?.director?.key;
  const save = async () => {
    setErr(null); setMsg(null);
    try {
      await api('/api/studio/settings', { method: 'PUT', body: {
        suggestion_emails: listInput(s.suggestion_text), approver_emails: listInput(s.approver_text), suggestion_wait_hours: Number(s.suggestion_wait_hours ?? 24),
        review_mode: s.review_mode ?? 'dashboard', storage_mode: s.storage_mode ?? 'drive', suggestion_window_hours: Number(s.suggestion_window_hours ?? 0),
        default_platforms: s.default_platforms, variants: s.variants, youtube_privacy: s.youtube_privacy, auto_publish_after_approval: !!s.auto_publish_after_approval,
        drive_scan_minutes: Number(s.drive_scan_minutes), glossary: listInput(s.glossary_text),
        director: { planner: dr.planner ?? 'claude', model: dr.model ?? 'claude-opus-5-5', helper_model: dr.helper_model ?? 'claude-sonnet-5-5', research: dr.research !== false,
          check_rounds: Number(dr.check_rounds ?? 1), budget_usd: Number(dr.budget_usd ?? 3) },
        brand: { company_name: b.company_name ?? '', handle: b.handle ?? '', tagline: b.tagline ?? '', cta: b.cta ?? '', colors: b.colors },
      } });
      setMsg('Saved. New videos use these settings; use "Re-edit with current settings" on a video to apply them there.');
      reload();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <PageHeader title="Studio settings" subtitle="People, brand kit and publishing rules for the Content Studio" actions={<Button variant="primary" onClick={save}>Save</Button>} />
      {msg && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-3">{msg}</div>}
      <ErrorBox error={err} />
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Claude director" subtitle="Claude plans every edit: it watches the footage, researches the topic, builds the 3D models it needs and checks its own storyboard" className="lg:col-span-2">
          <div className={`text-sm rounded-lg p-2 mb-3 border ${keyOk ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
            {keyOk ? <>Claude is connected (API key found in <code>.env</code>){status?.director?.gl === false ? ' — 3D rendering is not available on this computer' : ''}.</>
              : <>No Claude API key yet. Add the line <code>ANTHROPIC_API_KEY=sk-ant-…</code> to the <code>.env</code> file in the project folder (no restart needed). Until then the automatic editor is used.</>}
          </div>
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-2">
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={(dr.planner ?? 'claude') === 'claude'} onChange={() => setD('planner', 'claude')} />
                <span><b>Claude plans the edit</b> (recommended). Works for any topic: new 3D objects are modelled for each video and kept in the asset library.</span></label>
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={dr.planner === 'rules'} onChange={() => setD('planner', 'rules')} />
                <span><b>Automatic rules only</b>. No API cost; uses the built-in water-motor style objects.</span></label>
            </div>
            <div className="space-y-3">
              <Field label="Model that directs the edit" hint="Opus gives the best edits; Sonnet costs about half">
                <select className={inputCls} value={dr.model ?? 'claude-opus-5-5'} onChange={(e) => setD('model', e.target.value)}>
                  <option value="claude-opus-5-5">Claude Opus 5.5 (best)</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5 (cheaper)</option></select></Field>
              <Field label="Model for research, style cards and checks">
                <select className={inputCls} value={dr.helper_model ?? 'claude-sonnet-5-5'} onChange={(e) => setD('helper_model', e.target.value)}>
                  <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option><option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest)</option><option value="claude-opus-5-5">Claude Opus 5.5</option></select></Field>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={dr.research !== false} onChange={(e) => setD('research', e.target.checked)} />Research the topic on the web first</label>
              <Field label="Storyboard checks per version" hint="Claude looks at frames of its edit and fixes problems (0 = off)">
                <input type="number" min={0} max={3} className={inputCls} value={dr.check_rounds ?? 1} onChange={(e) => setD('check_rounds', e.target.value)} /></Field>
              <Field label="Budget per video (US$)" hint="Claude stops planning when a video reaches this; remaining versions use the automatic edit. Typical: $1–2 per style for a 1-minute video.">
                <input type="number" min={0.2} max={50} step={0.5} className={inputCls} value={dr.budget_usd ?? 3} onChange={(e) => setD('budget_usd', e.target.value)} /></Field>
            </div>
          </div>
        </Card>
        <Card title="Review and approval" subtitle="Who sees the versions and how they approve">
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={(s.review_mode ?? 'dashboard') === 'dashboard'} onChange={() => setS({ ...s, review_mode: 'dashboard' })} />
              <span><b>In the dashboard</b> (recommended). Colleagues log in, watch every version side by side, then press <i>Approve</i> or write the changes they want. No emails are sent. Anyone whose role can approve (Admin, Marketing manager or Approver) can do it; one approval is enough. Add colleagues under <a className="underline" href="/settings">Settings → Users</a> with the Approver role.</span></label>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={s.review_mode === 'email'} onChange={() => setS({ ...s, review_mode: 'email' })} />
              <span><b>By email</b>. Versions are emailed from the connected Gmail account and approvers reply "approved" or with changes.</span></label>
            {(s.review_mode ?? 'dashboard') === 'dashboard' ? (
              <Field label="Collect suggestions before editing (hours)" hint="0 = start editing straight away. Otherwise the video waits this long so colleagues can add suggestions on its page; their suggestions override the data rules.">
                <input type="number" min={0} max={168} className={inputCls} value={s.suggestion_window_hours ?? 0} onChange={(e) => setS({ ...s, suggestion_window_hours: e.target.value })} /></Field>
            ) : (
              <div className="space-y-3">
                <Field label="Suggestions — asked by email before editing" hint="Comma separated emails. Their suggestions override the data rules."><textarea className={`${inputCls} h-16`} value={s.suggestion_text} onChange={(e) => setS({ ...s, suggestion_text: e.target.value })} /></Field>
                <Field label="Wait for suggestions up to (hours)"><input type="number" min={0} max={168} className={inputCls} value={s.suggestion_wait_hours} onChange={(e) => setS({ ...s, suggestion_wait_hours: e.target.value })} /></Field>
                <Field label="Approvers — emailed the finished versions" hint="One approval is enough. Replies from other addresses are ignored."><textarea className={`${inputCls} h-16`} value={s.approver_text} onChange={(e) => setS({ ...s, approver_text: e.target.value })} /></Field>
              </div>)}
          </div>
        </Card>
        <Card title="Where the videos are kept" subtitle="Keep this computer's disk free">
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={(s.storage_mode ?? 'drive') === 'drive'} onChange={() => setS({ ...s, storage_mode: 'drive' })} />
              <span><b>Google Drive</b> (recommended). Raw takes, every version and the final video are kept in Drive (content_raw → content_midway → content_final). This computer only holds a temporary copy while a video is being edited; it is deleted as soon as the upload is done. The dashboard plays the videos straight from Drive.</span></label>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={s.storage_mode === 'local'} onChange={() => setS({ ...s, storage_mode: 'local' })} />
              <span><b>Keep copies on this computer too</b>. Faster to play, but uses disk space (about 30–60 MB per version).</span></label>
            <div className="text-xs text-ink-2">Drive is used once it is connected under <a className="underline" href="/integrations">Integrations → Google Drive &amp; Gmail</a>. Until then everything stays in the local <code>drive_local</code> folder.</div>
          </div>
        </Card>
        <Card title="Brand kit" subtitle="Used for the logo in the corner, name cards, graphics and the end card">
          <div className="flex items-start gap-4">
            <div className="w-28 h-28 rounded-xl border border-stone-200 bg-white flex items-center justify-center overflow-hidden">{b.logo_path ? <img src={`/api/studio/brand/logo?v=${logoV}`} className="max-w-full max-h-full" /> : <span className="text-xs text-ink-3">no logo</span>}</div>
            <div className="w-28 h-28 rounded-xl border border-stone-200 flex items-center justify-center overflow-hidden" style={{ background: b.colors?.dark ?? '#1e2e40' }}>{b.logo_light_path && <img src={`/api/studio/brand/logo?light=1&v=${logoV}`} className="max-w-full max-h-full" />}</div>
            <div className="text-xs text-ink-2 space-y-2">
              <div>Upload a PNG (transparent or white background). The colours are taken from the logo; a version for dark backgrounds is made automatically.</div>
              <input type="file" accept="image/png,image/jpeg" className="text-xs" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); try { const r = await api('/api/studio/brand/logo', { form: fd }); setMsg(r.low_resolution ? 'Logo saved. It is small — upload a larger PNG (1000 px or more) or an SVG for the sharpest result.' : 'Logo saved.'); setLogoV(Date.now()); reload(); } catch (x) { setErr((x as Error).message); } }} />
              {b.logo_vector_path && <div className="text-emerald-800">A crisp vector redraw of this logo is used (it builds itself on the end card).</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Field label="Company name"><input className={inputCls} value={b.company_name ?? ''} onChange={(e) => setB('company_name', e.target.value)} /></Field>
            <Field label="Handle"><input className={inputCls} value={b.handle ?? ''} onChange={(e) => setB('handle', e.target.value)} placeholder="@company" /></Field>
            <Field label="Tagline (end card)"><input className={inputCls} value={b.tagline ?? ''} onChange={(e) => setB('tagline', e.target.value)} /></Field>
            <Field label="Default call to action"><input className={inputCls} value={b.cta ?? ''} onChange={(e) => setB('cta', e.target.value)} placeholder="Follow for more" /></Field>
          </div>
          <div className="flex flex-wrap gap-3 mt-4">{COLOR_ROLES.map(([k, l]) => (
            <label key={k} className="text-xs text-ink-2 flex items-center gap-2"><input type="color" value={b.colors?.[k] ?? '#000000'} onChange={(e) => setB('colors', { ...(b.colors ?? {}), [k]: e.target.value })} />{l}</label>))}</div>
          <div className="text-xs text-ink-2 mt-3">Captions: bold white with the spoken word in yellow, placed above the platform buttons. Fonts: Montserrat and Inter (free licence).</div>
        </Card>
        <Card title="Versions and words">
          <div className="text-xs font-medium text-ink-2 mb-1">Styles made for every new video (can be changed per video)</div>
          <StylePicker styles={styles} value={s.variants ?? []} onChange={(v) => setS({ ...s, variants: v })} />
          <div className="mt-4"><Field label="Product names and key terms" hint="Highlighted when spoken, and spelled correctly"><textarea className={`${inputCls} h-16`} value={s.glossary_text} onChange={(e) => setS({ ...s, glossary_text: e.target.value })} /></Field></div>
        </Card>
        <Card title="Publishing">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!s.auto_publish_after_approval} onChange={(e) => setS({ ...s, auto_publish_after_approval: e.target.checked })} />Publish automatically after approval</label>
          <div className="mt-3 text-xs font-medium text-ink-2">Default platforms</div>
          {['instagram', 'facebook', 'youtube'].map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" checked={(s.default_platforms ?? []).includes(p)} onChange={(e) => setS({ ...s, default_platforms: e.target.checked ? [...(s.default_platforms ?? []), p] : (s.default_platforms ?? []).filter((x: string) => x !== p) })} />{p[0].toUpperCase() + p.slice(1)}</label>))}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="YouTube visibility" hint="Keep 'private' until Google's API audit is approved (unaudited uploads are locked to private).">
              <select className={inputCls} value={s.youtube_privacy} onChange={(e) => setS({ ...s, youtube_privacy: e.target.value })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select>
            </Field>
            <Field label="Check Google Drive every (minutes)"><input type="number" min={1} max={120} className={inputCls} value={s.drive_scan_minutes} onChange={(e) => setS({ ...s, drive_scan_minutes: e.target.value })} /></Field>
          </div>
        </Card>
      </div>
    </>
  );
}
