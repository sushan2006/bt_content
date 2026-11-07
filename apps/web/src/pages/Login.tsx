import { FormEvent, useState } from 'react';
import { api, Me } from '../lib';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';

export default function Login({ onLogin }: { onLogin: (m: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try { onLogin((await api<{ user: Me }>('/api/auth/login', { body: { email, password } })).user); } catch (er) { setError((er as Error).message); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <form onSubmit={submit} className="bg-white border border-stone-200 rounded-xl p-8 w-[380px] space-y-4">
        <div><h1 className="text-xl font-semibold">Content Intelligence Platform</h1><p className="text-sm text-ink-2 mt-1">Sign in with your company account</p></div>
        <ErrorBox error={error} />
        <Field label="Email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
        <Field label="Password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Button type="submit" variant="primary">Sign in</Button>
      </form>
    </div>
  );
}
