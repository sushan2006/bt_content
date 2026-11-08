import { useEffect, useState } from 'react';
import { api, can, fmt, useApi } from '../lib';
import { Badge, Button, Card, ErrorBox, Field, inputCls, PageHeader, Table, Tabs } from '../components/ui';
import { useMe } from '../main';

export default function Settings() {
  const me = useMe();
  const tabs = [
    ...(can(me, 'users.manage') ? [{ key: 'users', label: 'Users', content: <Users /> }] : []),
    ...(can(me, 'categories.manage') ? [{ key: 'cats', label: 'Categories & campaigns', content: <Categories /> }] : []),
    ...(can(me, 'settings.manage') ? [{ key: 'adv', label: 'Advanced', content: <div className="space-y-5"><p className="text-sm text-ink-2">Settings of the analysis engine. The defaults are fine; change them only if you know why.</p><AppSettings /><SegmentsTpl /></div> }] : []),
    ...(can(me, 'audit.view') ? [{ key: 'audit', label: 'Activity log', content: <Audit /> }] : []),
  ];
  return <><PageHeader title="Settings" /><Tabs tabs={tabs} /></>;
}

const ROLE_TEXT: Record<string, string> = {
  admin: 'Everything: set up videos and copy their prompts, publish, connect accounts, run the analysis, manage users and settings.',
  viewer: 'Sees every page and video and can add suggestions to a video while it is being made. Cannot publish or change anything.',
};

function Users() {
  const { data, reload } = useApi<any[]>('/api/users');
  const roles = useApi<any[]>('/api/roles').data ?? [];
  const [f, setF] = useState({ email: '', full_name: '', password: '', role: 'viewer' });
  const [err, setErr] = useState<string | null>(null);
  const roleSelect = (value: string, onChange: (v: string) => void) => (
    <select className={`${inputCls} !w-auto !py-1`} value={value} onChange={(e) => onChange(e.target.value)}>{roles.map((ro) => <option key={ro.code} value={ro.code}>{ro.name}</option>)}</select>);
  return <div className="space-y-5">
    <div className="grid md:grid-cols-2 gap-3">{roles.map((r) => (
      <div key={r.code} className="bg-white border border-stone-200 rounded-xl p-4"><div className="font-semibold text-ink">{r.name}</div><div className="text-sm text-ink-2 mt-1">{ROLE_TEXT[r.code] ?? r.description}</div></div>))}</div>
    <Card title="Users"><Table rows={data ?? []} columns={[
      { key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role', render: (r) => roleSelect(r.role, async (v) => { await api(`/api/users/${r.id}`, { method: 'PATCH', body: { role: v } }).catch((x) => alert(x.message)); reload(); }) },
      { key: 'is_active', label: 'Active', render: (r) => <input type="checkbox" checked={r.is_active} onChange={async (e) => { await api(`/api/users/${r.id}`, { method: 'PATCH', body: { is_active: e.target.checked } }).catch((x) => alert(x.message)); reload(); }} /> },
      { key: 'last_login_at', label: 'Last login', render: (r) => fmt.ago(r.last_login_at) },
    ]} /></Card>
    <Card title="Add a user"><ErrorBox error={err} /><div className="grid md:grid-cols-5 gap-3 items-end">
      <Field label="Full name"><input className={inputCls} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
      <Field label="Email"><input className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="First password (10+ characters)"><input className={inputCls} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
      <Field label="Role">{roleSelect(f.role, (v) => setF({ ...f, role: v }))}</Field>
      <Button variant="primary" onClick={async () => { setErr(null); try { await api('/api/users', { body: f }); setF({ email: '', full_name: '', password: '', role: 'viewer' }); reload(); } catch (e) { setErr((e as Error).message); } }}>Add</Button>
    </div></Card>
  </div>;
}

function Categories() {
  const cats = useApi<any[]>('/api/categories');
  const camps = useApi<any[]>('/api/campaigns');
  const [c, setC] = useState({ code: '', name: '', group_code: 'purpose' });
  const [k, setK] = useState({ code: '', name: '', objective: 'lead_generation', start_date: '', end_date: '' });
  const [err, setErr] = useState<string | null>(null);
  return <div className="grid lg:grid-cols-2 gap-5"><ErrorBox error={err} />
    <Card title="Content categories" subtitle="Initial examples — add or rename freely">
      <Table rows={cats.data ?? []} columns={[{ key: 'group_code', label: 'Group' }, { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name', render: (r) => <input className={`${inputCls} !py-1`} defaultValue={r.name} onBlur={async (e) => { if (e.target.value !== r.name) { await api(`/api/categories/${r.id}`, { method: 'PUT', body: { name: e.target.value, is_active: r.is_active } }); cats.reload(); } }} /> }]} />
      <div className="grid grid-cols-4 gap-2 mt-3 items-end">
        <Field label="Group"><select className={inputCls} value={c.group_code} onChange={(e) => setC({ ...c, group_code: e.target.value })}><option>purpose</option><option>topic</option><option>product</option></select></Field>
        <Field label="Code"><input className={inputCls} placeholder="product_launch" value={c.code} onChange={(e) => setC({ ...c, code: e.target.value })} /></Field>
        <Field label="Name"><input className={inputCls} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
        <Button onClick={async () => { setErr(null); try { await api('/api/categories', { body: c }); setC({ code: '', name: '', group_code: 'purpose' }); cats.reload(); } catch (e) { setErr((e as Error).message); } }}>Add</Button>
      </div>
    </Card>
    <Card title="Campaigns" subtitle="Group videos by campaign to compare them">
      <Table rows={camps.data ?? []} columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'objective', label: 'Objective', render: (r) => fmt.label(r.objective) }, { key: 'd', label: 'Dates', render: (r) => `${r.start_date ?? '—'} → ${r.end_date ?? '—'}` }]} />
      <div className="grid grid-cols-3 gap-2 mt-3 items-end">
        <Field label="Code"><input className={inputCls} placeholder="q1_launch" value={k.code} onChange={(e) => setK({ ...k, code: e.target.value })} /></Field>
        <Field label="Name"><input className={inputCls} value={k.name} onChange={(e) => setK({ ...k, name: e.target.value })} /></Field>
        <Field label="Objective"><select className={inputCls} value={k.objective} onChange={(e) => setK({ ...k, objective: e.target.value })}><option value="brand_awareness">Brand awareness</option><option value="product_awareness">Product awareness</option><option value="engagement">Engagement</option><option value="lead_generation">Lead generation</option></select></Field>
        <Field label="Start"><input type="date" className={inputCls} value={k.start_date} onChange={(e) => setK({ ...k, start_date: e.target.value })} /></Field>
        <Field label="End"><input type="date" className={inputCls} value={k.end_date} onChange={(e) => setK({ ...k, end_date: e.target.value })} /></Field>
        <Button onClick={async () => { setErr(null); try { await api('/api/campaigns', { body: { ...k, start_date: k.start_date || null, end_date: k.end_date || null } }); camps.reload(); } catch (e) { setErr((e as Error).message); } }}>Add campaign</Button>
      </div>
    </Card>
  </div>;
}

function SegmentsTpl() {
  const { data, reload } = useApi<any[]>('/api/segment-templates');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const t = data?.find((x) => x.is_default);
  useEffect(() => { if (t) setText(JSON.stringify(t.segments, null, 2)); }, [t?.id]);
  return <Card title="Video segment template" subtitle='Seconds (3), percent of duration ("40%") or from the end ("-15%"). Segments are automatically fitted to each video’s real length; the ending segment is anchored to the end.'>
    <ErrorBox error={err} />
    <textarea className={`${inputCls} h-64 font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} />
    <div className="mt-2"><Button variant="primary" onClick={async () => { setErr(null); try { await api(`/api/segment-templates/${t.id}`, { method: 'PUT', body: { segments: JSON.parse(text) } }); reload(); } catch (e) { setErr((e as Error).message); } }}>Save template</Button></div>
    <p className="text-xs text-ink-3 mt-2">After changing segments, re-run video analysis and the intelligence run so comparisons use the new boundaries.</p>
  </Card>;
}

function AppSettings() {
  const { data, reload } = useApi<any>('/api/settings');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setDraft(Object.fromEntries(['analysis', 'sync', 'company'].map((k) => [k, JSON.stringify(data[k] ?? {}, null, 2)]))); }, [data]);
  const help: Record<string, string> = {
    analysis: 'Minimum sample sizes before a pattern can be called preliminary / moderate / strong, significance level, bootstrap iterations.',
    sync: 'Sync interval (minutes, applied on API restart), initial backfill window, max posts per sync, hours after which data is flagged stale.',
    company: 'Company name and phrases that identify a "company introduction" opening; timezone used for publishing-time analysis.',
  };
  return <div className="grid lg:grid-cols-3 gap-5"><ErrorBox error={err} />
    {Object.keys(draft).map((k) => <Card key={k} title={fmt.label(k)} subtitle={help[k]}>
      <textarea className={`${inputCls} h-48 font-mono text-xs`} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      <div className="mt-2"><Button onClick={async () => { setErr(null); try { await api(`/api/settings/${k}`, { method: 'PUT', body: JSON.parse(draft[k]) }); reload(); } catch (e) { setErr((e as Error).message); } }}>Save</Button></div>
    </Card>)}
  </div>;
}

function Audit() {
  const { data } = useApi<any[]>('/api/audit');
  return <Card subtitle="Account connections, exports, permission changes, analysis runs and other important actions"><Table rows={data ?? []} columns={[
    { key: 'created_at', label: 'Time', render: (r) => fmt.dt(r.created_at) }, { key: 'full_name', label: 'User', render: (r) => r.full_name ?? 'system' },
    { key: 'action', label: 'Action', render: (r) => <Badge>{r.action}</Badge> }, { key: 'entity_type', label: 'Entity' },
    { key: 'details', label: 'Details', render: (r) => <span className="text-xs font-mono text-ink-2">{r.details ? JSON.stringify(r.details).slice(0, 140) : ''}</span> }, { key: 'ip', label: 'IP' },
  ]} /></Card>;
}
