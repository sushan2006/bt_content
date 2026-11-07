import { useState } from 'react';
import { api, can, fmt, useApi } from '../../lib';
import { Badge, Button, Card, ErrorBox, Field, inputCls, Loading, PageHeader, Table } from '../../components/ui';
import { useMe } from '../../main';

const SOURCES: Record<string, { name: string; note: string }> = {
  pixabay: { name: 'Pixabay Music', note: 'Free for commercial use, no credit needed. Skip tracks marked "Content ID Registered" and download the licence certificate.' },
  youtube_audio_library: { name: 'YouTube Audio Library', note: 'Check each track: some need a credit, and the licence decides if it may be used off YouTube.' },
  meta_sound_collection: { name: 'Meta Sound Collection', note: 'Royalty-free, cleared for commercial use on Instagram and Facebook.' },
  uppbeat: { name: 'Uppbeat', note: 'Free and paid plans; keep the licence code for each track.' },
  epidemic_sound: { name: 'Epidemic Sound', note: 'Paid; covers all platforms for business accounts.' },
  artlist: { name: 'Artlist', note: 'Paid; covers social platforms.' },
  own: { name: 'Our own music', note: 'Composed for the company; keep the agreement.' },
  other: { name: 'Other', note: 'Upload the licence that allows commercial use on social media.' },
};

export default function StudioMusic({ embedded = false }: { embedded?: boolean }) {
  const me = useMe();
  const { data, reload } = useApi<any[]>('/api/studio/music');
  const [f, setF] = useState<any>({ title: '', artist: '', source: 'pixabay', source_url: '', license_note: '', mood: '', content_id_registered: false });
  const [file, setFile] = useState<File | null>(null);
  const [license, setLicense] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const manage = can(me, 'studio.manage');
  const add = async () => {
    setErr(null);
    if (!file) return setErr('Choose the music file');
    if (!license && !f.license_note.trim()) return setErr('Add the licence file or write the licence details. Only licensed music can be used.');
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append('file', file);
    if (license) fd.append('license', license);
    setBusy(true);
    try { await api('/api/studio/music', { form: fd }); setFile(null); setLicense(null); setF({ ...f, title: '', artist: '', source_url: '', license_note: '' }); reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {embedded ? <p className="text-sm text-ink-2 mb-4">Only licensed music. A track can only be chosen when its licence proof is stored here.</p>
        : <PageHeader title="Music library" subtitle="Only licensed music. A track can only be chosen when its licence proof is stored here." />}
      <div className="grid lg:grid-cols-3 gap-5">
        <Card title="Tracks" className="lg:col-span-2">
          <Table rows={data} empty="No tracks yet" columns={[
            { key: 'title', label: 'Track', render: (r) => <div><div className="font-medium">{r.title}</div><div className="text-xs text-ink-3">{r.artist}</div></div> },
            { key: 'source', label: 'Source', render: (r) => SOURCES[r.source]?.name ?? r.source },
            { key: 'mood', label: 'Mood' },
            { key: 'license_path', label: 'Licence', render: (r) => (r.license_path ? <Badge color="green">stored</Badge> : <Badge color="red">missing</Badge>) },
            { key: 'cid', label: 'Content ID', render: (r) => (r.content_id_registered ? <Badge color="red">registered — blocked</Badge> : <Badge>clear</Badge>) },
            { key: 'play', label: '', render: (r) => <audio src={`/api/studio/music/${r.id}/audio`} controls preload="none" className="h-8 w-48" /> },
            { key: 'a', label: '', render: (r) => manage && <Button small onClick={async () => { await api(`/api/studio/music/${r.id}`, { method: 'PATCH', body: { is_active: !r.is_active } }); reload(); }}>{r.is_active ? 'Disable' : 'Enable'}</Button> },
            { key: 'created_at', label: 'Added', render: (r) => fmt.date(r.created_at) },
          ]} />
        </Card>
        {manage && <Card title="Add a track">
          <div className="space-y-3">
            <Field label="Music file (mp3, wav, m4a)"><input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" /></Field>
            <Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Artist"><input className={inputCls} value={f.artist} onChange={(e) => setF({ ...f, artist: e.target.value })} /></Field>
            <Field label="Where it is from" hint={SOURCES[f.source]?.note}>
              <select className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select>
            </Field>
            <Field label="Track page link"><input className={inputCls} value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} placeholder="https://pixabay.com/music/..." /></Field>
            <Field label="Licence file (certificate, PDF or screenshot)"><input type="file" onChange={(e) => setLicense(e.target.files?.[0] ?? null)} className="text-xs" /></Field>
            <Field label="Or licence details"><textarea className={`${inputCls} h-16`} value={f.license_note} onChange={(e) => setF({ ...f, license_note: e.target.value })} placeholder="Licence code / terms" /></Field>
            <Field label="Mood"><input className={inputCls} value={f.mood} onChange={(e) => setF({ ...f, mood: e.target.value })} placeholder="upbeat, calm, corporate" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.content_id_registered} onChange={(e) => setF({ ...f, content_id_registered: e.target.checked })} />The track page says "Content ID registered"</label>
            <ErrorBox error={err} />
            <Button variant="primary" disabled={busy} onClick={add}>{busy ? 'Uploading…' : 'Add track'}</Button>
          </div>
        </Card>}
      </div>
    </>
  );
}
