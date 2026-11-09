import { useEffect, useState } from 'react';
import { api, can, fmt, useApi } from '../lib';
import { Badge, Button, Card, ErrorBox, Field, inputCls, PageHeader, Table, Tabs } from '../components/ui';
import { useMe } from '../main';
import AdvancedSettings from './AdvancedSettings';

export default function Settings() {
  const me = useMe();
  const tabs = [
    ...(can(me, 'users.manage') ? [{ key: 'users', label: 'Users', content: <Users /> }] : []),
    ...(can(me, 'settings.manage') ? [{ key: 'adv', label: 'Analytics settings', content: <AdvancedSettings /> }] : []),
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
