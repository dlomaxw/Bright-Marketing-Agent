'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Field, buttonClass, inputClass } from '@/components/ui';

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Sign in failed.');
        setBusy(false);
        return;
      }
      router.push(next && next.startsWith('/') ? next : '/');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-[#f3c6c3] bg-critical-bg px-3 py-2 text-[13px] text-critical">
          {error}
        </p>
      )}

      <Field label="Email address" required>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="you@brightthoughts.example"
        />
      </Field>

      <Field label="Password" required>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </Field>

      <button type="submit" disabled={busy} className={`${buttonClass('primary')} w-full`}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-[11px] text-muted-soft">
        Sessions expire automatically. Sign-in attempts are recorded in the activity log.
      </p>
    </form>
  );
}
