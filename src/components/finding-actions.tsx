'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Notice, buttonClass, inputClass } from '@/components/ui';
import { CONFIDENCES, SEVERITIES } from '@/lib/enums';

interface Permissions {
  verify: boolean;
  edit: boolean;
  dismiss: boolean;
  visibility: boolean;
  recheck: boolean;
}

export function FindingActions({
  findingId,
  organizationId,
  verificationStatus,
  clientVisible,
  requiresReverification,
  severity,
  confidence,
  observationText,
  businessImpact,
  recommendation,
  analystNote,
  permissions,
}: {
  findingId: string;
  organizationId: string;
  verificationStatus: string;
  clientVisible: boolean;
  requiresReverification: boolean;
  severity: string;
  confidence: string;
  observationText: string;
  businessImpact: string;
  recommendation: string;
  analystNote: string | null;
  permissions: Permissions;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissReason, setDismissReason] = useState('');

  const [form, setForm] = useState({
    severity,
    confidence,
    observationText,
    businessImpact,
    recommendation,
    analystNote: analystNote ?? '',
  });

  async function call(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'The change could not be saved.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const isVerified = verificationStatus === 'manually_verified';
  const isDismissed = verificationStatus === 'dismissed';

  return (
    <Card title="Review this finding" description="Nothing reaches a client document until it is verified here.">
      {error && (
        <p role="alert" className="mb-3 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
          {error}
        </p>
      )}

      {!permissions.verify && !permissions.edit && !permissions.dismiss && (
        <p className="text-xs text-muted">Your role can read findings but not change their status.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {permissions.verify && !isVerified && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => call({ action: 'accept' }, 'accept')}
            className={buttonClass('primary')}
          >
            {busy === 'accept' ? 'Saving…' : 'Accept as verified'}
          </button>
        )}
        {permissions.verify && verificationStatus !== 'needs_review' && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => call({ action: 'needs_review' }, 'needs_review')}
            className={buttonClass('secondary')}
          >
            Mark needs review
          </button>
        )}
        {permissions.edit && (
          <button type="button" onClick={() => setEditing((v) => !v)} className={buttonClass('secondary')}>
            {editing ? 'Cancel edit' : 'Edit wording'}
          </button>
        )}
        {permissions.dismiss && !isDismissed && (
          <button type="button" onClick={() => setDismissing((v) => !v)} className={buttonClass('danger')}>
            Dismiss
          </button>
        )}
        {permissions.recheck && (
          <a href={`/leads/${organizationId}`} className={buttonClass('ghost')}>
            Re-check with a new audit
          </a>
        )}
      </div>

      {dismissing && (
        <div className="mt-3 rounded-md border border-line bg-canvas p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">
              Why is this being dismissed? <span className="text-critical">*</span>
            </span>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder="e.g. the page is intentionally excluded from search and is not part of the public site"
            />
          </label>
          <p className="mt-1 text-[11px] text-muted">
            The reason is recorded in the audit trail against your name.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy !== null || dismissReason.trim().length < 3}
              onClick={async () => {
                const ok = await call({ action: 'dismiss', reason: dismissReason }, 'dismiss');
                if (ok) setDismissing(false);
              }}
              className={buttonClass('danger')}
            >
              {busy === 'dismiss' ? 'Dismissing…' : 'Confirm dismissal'}
            </button>
            <button type="button" onClick={() => setDismissing(false)} className={buttonClass('ghost')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 rounded-md border border-line bg-canvas p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-navy">Severity</span>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className={inputClass}
              >
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-navy">Evidence confidence</span>
              <select
                value={form.confidence}
                onChange={(e) => setForm({ ...form, confidence: e.target.value })}
                className={inputClass}
              >
                {CONFIDENCES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Observation (neutral statement of fact)</span>
            <textarea
              value={form.observationText}
              onChange={(e) => setForm({ ...form, observationText: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Possible business impact</span>
            <textarea
              value={form.businessImpact}
              onChange={(e) => setForm({ ...form, businessImpact: e.target.value })}
              rows={2}
              className={inputClass}
            />
            <span className="mt-1 block text-[11px] text-muted">
              Phrase as a possibility, not a certainty. Avoid any figure that is not in the evidence.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Recommended action</span>
            <textarea
              value={form.recommendation}
              onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Analyst note (internal only)</span>
            <textarea
              value={form.analystNote}
              onChange={(e) => setForm({ ...form, analystNote: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </label>

          <button
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              const ok = await call({ action: 'edit', ...form }, 'edit');
              if (ok) setEditing(false);
            }}
            className={buttonClass('primary')}
          >
            {busy === 'edit' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}

      {permissions.visibility && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Client-facing visibility
          </p>

          {!isVerified ? (
            <Notice tone="info">
              This finding must be accepted as verified before it can be shown to a client.
            </Notice>
          ) : requiresReverification ? (
            <Notice tone="warn">
              Imported findings must be re-observed by an audit run before they can be shown to a
              client, however they are verified.
            </Notice>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => call({ action: 'set_visibility', clientVisible: !clientVisible }, 'visibility')}
                className={buttonClass(clientVisible ? 'secondary' : 'primary')}
              >
                {busy === 'visibility'
                  ? 'Saving…'
                  : clientVisible
                    ? 'Remove from client-facing output'
                    : 'Approve for client-facing output'}
              </button>
              <span className="text-[11px] text-muted">
                {clientVisible
                  ? 'This finding may appear in reports, proposals and emails.'
                  : 'This finding is internal only.'}
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
