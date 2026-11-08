import { useEffect, useState } from 'react';
import { api, useApi } from '../../lib';
import { Button, Card, ErrorBox, Field, inputCls, Loading, PageHeader } from '../../components/ui';
import { listInput, PLATFORMS } from './common';

const COLOR_ROLES: [string, string][] = [['primary', 'Main colour'], ['accent', 'Highlight colour'], ['alert', 'Alert colour'], ['dark', 'Dark background'], ['darker', 'Darkest background']];

/** Brand kit and defaults that go into every prompt, and the publishing settings. */
export default function StudioSettings() {
  const { data, reload } = useApi<any>('/api/studio/settings');
  const styles = useApi<any[]>('/api/studio/styles').data ?? [];
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logoV, setLogoV] = useState(Date.now());
  useEffect(() => { if (data) setS({ ...data, glossary_text: (data.glossary ?? []).join(', ') }); }, [data]);
  if (!s) return <Loading />;
  const b = s.brand ?? {};
  const setB = (k: string, v: any) => setS({ ...s, brand: { ...b, [k]: v } });
  const save = async () => {
    setErr(null); setMsg(null);
    try {
      await api('/api/studio/settings', { method: 'PUT', body: {
        storage_mode: s.storage_mode ?? 'drive', default_platforms: s.default_platforms ?? [], default_style: s.default_style ?? 'paper_cutout',
        default_format: s.default_format ?? '9:16', default_length_sec: Math.max(5, Number(s.default_length_sec ?? 30)),
        youtube_privacy: s.youtube_privacy ?? 'private', drive_scan_minutes: Math.max(1, Number(s.drive_scan_minutes ?? 5)), glossary: listInput(s.glossary_text ?? ''),
        brand: { company_name: b.company_name ?? '', handle: b.handle ?? '', tagline: b.tagline ?? '', cta: b.cta ?? '', colors: b.colors ?? {} },
      } });
      setMsg('Saved. Prompts copied from now on use these settings.');
      reload();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <PageHeader title="Studio settings" subtitle="The brand kit and defaults written into every prompt, where files are kept, and publishing" actions={<Button variant="primary" onClick={save}>Save</Button>} />
      {msg && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 mb-3">{msg}</div>}
      <ErrorBox error={err} />
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Brand kit" subtitle="Claude uses the logo on the end card and the colours as accents in every style">
          <div className="flex items-start gap-4">
            <div className="w-28 h-28 rounded-xl border border-stone-200 bg-white flex items-center justify-center overflow-hidden shrink-0">{b.logo_path ? <img src={`/api/studio/brand/logo?v=${logoV}`} className="max-w-full max-h-full" alt="logo" /> : <span className="text-xs text-ink-3">no logo</span>}</div>
            <div className="text-xs text-ink-2 space-y-2">
              <div>Upload a PNG (transparent background works best). It is kept in Drive › _assets › brand_kit and linked in the prompt{b.logo_drive_link ? '' : ' once Google Drive is connected'}.</div>
              <input type="file" accept="image/png,image/jpeg" className="text-xs" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); try { const r = await api('/api/studio/brand/logo', { form: fd }); setMsg(r.found_colors ? 'Logo saved and its colours picked up below.' : 'Logo saved.'); setLogoV(Date.now()); reload(); } catch (x) { setErr((x as Error).message); } }} />
              {b.logo_drive_link && <a className="underline block" href={b.logo_drive_link} target="_blank" rel="noreferrer">Logo in Drive</a>}
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
          <div className="mt-4"><Field label="Product names and key terms" hint="Spelled exactly like this in captions and on screen; comma separated"><textarea className={`${inputCls} h-16`} value={s.glossary_text} onChange={(e) => setS({ ...s, glossary_text: e.target.value })} /></Field></div>
        </Card>

        <div className="space-y-5">
          <Card title="Defaults for a new video">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Style"><select className={inputCls} value={s.default_style ?? 'paper_cutout'} onChange={(e) => setS({ ...s, default_style: e.target.value })}>
                {styles.filter((x) => x.status === 'ready').map((x) => <option key={x.key} value={x.key}>{x.group === 'reference' ? `${x.name} (reference)` : x.name}</option>)}</select></Field>
              <Field label="Format"><select className={inputCls} value={s.default_format ?? '9:16'} onChange={(e) => setS({ ...s, default_format: e.target.value })}><option value="9:16">Vertical 9:16</option><option value="16:9">Horizontal 16:9</option></select></Field>
              <Field label="Length (seconds)"><input type="number" min={5} max={1800} className={inputCls} value={s.default_length_sec ?? 30} onChange={(e) => setS({ ...s, default_length_sec: e.target.value })} /></Field>
            </div>
            <div className="mt-3 text-xs font-medium text-ink-2">Platforms</div>
            {PLATFORMS.map((p) => (
              <label key={p.k} className="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" checked={(s.default_platforms ?? []).includes(p.k)} onChange={(e) => setS({ ...s, default_platforms: e.target.checked ? [...(s.default_platforms ?? []), p.k] : (s.default_platforms ?? []).filter((x: string) => x !== p.k) })} />{p.l}</label>))}
          </Card>

          <Card title="Google Drive" subtitle="Where the material and the finished videos are kept">
            <div className="space-y-3 text-sm">
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={(s.storage_mode ?? 'drive') === 'drive'} onChange={() => setS({ ...s, storage_mode: 'drive' })} />
                <span><b>Google Drive only</b> (recommended). Takes, voiceovers and pictures are uploaded to the video's folder in content_midway and then removed from this computer.</span></label>
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={s.storage_mode === 'local'} onChange={() => setS({ ...s, storage_mode: 'local' })} />
                <span><b>Keep a copy on this computer too</b>. Uses disk space.</span></label>
              <Field label="Check content_raw and content_final every (minutes)"><input type="number" min={1} max={120} className={`${inputCls} max-w-[8rem]`} value={s.drive_scan_minutes ?? 5} onChange={(e) => setS({ ...s, drive_scan_minutes: e.target.value })} /></Field>
            </div>
          </Card>

          <Card title="Publishing">
            <Field label="YouTube visibility" hint="Keep 'private' until Google's API audit is approved (unaudited uploads are locked to private).">
              <select className={`${inputCls} max-w-xs`} value={s.youtube_privacy ?? 'private'} onChange={(e) => setS({ ...s, youtube_privacy: e.target.value })}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select>
            </Field>
            <div className="text-xs text-ink-3 mt-2">Videos are published from the Completed page when you press Publish, with the captions you write there.</div>
          </Card>
        </div>
      </div>
    </>
  );
}
