'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '@/components/ui';

/**
 * Discards a draft proposal or email.
 *
 * Two clicks, not one. A single-click delete beside Save is the kind of control
 * people hit by accident, and the confirmation here is inline rather than a
 * browser dialog so it says what will actually happen.
 *
 * The server decides what may go: an approved proposal and a sent email are
 * both refused there, because they are part of the record of what a business
 * was told. This only asks.
 */
export function DeleteAction({
  endpoint,
  label,
  confirmLabel,
  redirectTo,
}: {
  endpoint: string;
  label: string;
  confirmLabel: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      const data = payload?.data ?? payload;
      if (!res.ok) {
        setError(data?.error ?? 'It could not be deleted.');
        setArmed(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <span className="text-[12px] text-critical" role="alert">
        {error}
      </span>
    );
  }

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className={buttonClass('danger')}>
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} onClick={remove} className={buttonClass('danger')}>
        {busy ? 'Deleting…' : confirmLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setArmed(false)}
        className="text-[12px] font-semibold text-muted hover:text-navy"
      >
        Cancel
      </button>
    </span>
  );
}
