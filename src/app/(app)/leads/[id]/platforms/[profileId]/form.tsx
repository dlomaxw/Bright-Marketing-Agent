'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, buttonClass, inputClass } from '@/components/ui';
import type { ChecklistItem } from '@/audit/checks/social';

const BOOLEAN_CHOICES = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Not checked' },
] as const;

export function ChecklistForm({
  organizationId,
  profileId,
  profileUrl,
  items,
  saved,
  notes: savedNotes,
  editable,
}: {
  organizationId: string;
  profileId: string;
  profileUrl: string;
  items: ChecklistItem[];
  saved: Record<string, string>;
  notes: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(saved);
  const [notes, setNotes] = useState(savedNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // An item is only "answered" once the reviewer has actually said something.
  // A boolean left at "Not checked" counts as unanswered on purpose.
  const answered = items.filter((item) => {
    const value = answers[item.key];
    return value !== undefined && value !== '' && value !== 'unknown';
  }).length;

  function set(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setDone(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/profiles/${profileId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers, notes }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'The review could not be saved.');
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Review checklist"
      description={`${answered} of ${items.length} item(s) answered.`}
      action={
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={`${buttonClass('secondary')} text-xs`}
        >
          Open profile ↗
        </a>
      }
    >
      {error && (
        <p role="alert" className="mb-3 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
          {error}
        </p>
      )}
      {done && (
        <p className="mb-3 rounded border border-[#b9e0cd] bg-good-bg px-2.5 py-1.5 text-[12px] text-good">
          Review saved. It is recorded against your name in the activity log.
        </p>
      )}

      <ul className="divide-y divide-line-soft">
        {items.map((item) => (
          <li key={item.key} className="py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">{item.label}</p>
                {item.help && <p className="text-[11px] text-muted">{item.help}</p>}
              </div>

              {item.kind === 'boolean' ? (
                <div className="flex shrink-0 gap-1" role="group" aria-label={item.label}>
                  {BOOLEAN_CHOICES.map((choice) => {
                    const active = (answers[item.key] ?? 'unknown') === choice.value;
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        disabled={!editable || busy}
                        onClick={() => set(item.key, choice.value)}
                        aria-pressed={active}
                        className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                          active
                            ? 'border-navy bg-navy text-white'
                            : 'border-line bg-white text-muted hover:border-blue-100'
                        }`}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type={item.kind === 'date' ? 'date' : 'text'}
                  disabled={!editable || busy}
                  value={answers[item.key] ?? ''}
                  onChange={(e) => set(item.key, e.target.value)}
                  aria-label={item.label}
                  className={`${inputClass} max-w-[220px] shrink-0`}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-semibold text-navy">Reviewer notes</span>
        <textarea
          rows={3}
          disabled={!editable || busy}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDone(false);
          }}
          placeholder="What you observed, in your own words. This is an internal note."
          className={inputClass}
        />
      </label>

      {editable ? (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={save} disabled={busy} className={buttonClass('primary')}>
            {busy ? 'Saving…' : 'Save review'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted">Your role does not permit editing this review.</p>
      )}
    </Card>
  );
}
