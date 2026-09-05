'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, buttonClass, inputClass } from '@/components/ui';
import type { GateReport } from '@/server/emails/gates';

interface DraftShape {
  id: string;
  version: number;
  status: string;
  subject: string;
  body: string;
  toEmail: string | null;
  toName: string | null;
  contactId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  attachReport: boolean;
  attachProposal: boolean;
}

interface ContactOption {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  verificationStatus: string;
  optedOut: boolean;
}

/**
 * The Send button is disabled unless the server-evaluated gate report says every
 * gate passes. The server re-evaluates on submit regardless, so this is a
 * usability affordance, not the control.
 */
export function EmailWorkbench({
  draft,
  contacts,
  gates,
  permissions,
  providerConnected,
}: {
  draft: DraftShape;
  contacts: ContactOption[];
  gates: GateReport;
  permissions: { edit: boolean; submit: boolean; approve: boolean; send: boolean; cancel: boolean };
  providerConnected: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [contactId, setContactId] = useState(draft.contactId ?? '');
  const [comment, setComment] = useState('');
  const [dirty, setDirty] = useState(false);

  const sent = ['sent', 'delivered', 'replied', 'bounced'].includes(draft.status);
  const editable = permissions.edit && !sent && draft.status !== 'approved';

  async function post(url: string, payload: unknown, label: string, method: 'POST' | 'PATCH' = 'POST') {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string; details?: { gates?: { label: string; detail: string }[] } };
      if (!res.ok) {
        const gateDetail = data.details?.gates?.map((g) => `${g.label}: ${g.detail}`).join(' · ');
        setError(gateDetail ? `${data.error} ${gateDetail}` : (data.error ?? 'The action failed.'));
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

  const blocking = gates.gates.filter((g) => g.status === 'fail');
  const warnings = gates.gates.filter((g) => g.status === 'warn');

  return (
    <>
      <Card
        title="Message"
        description={editable ? 'Edit the subject and body. Only verified observations may be referenced.' : 'This version is locked.'}
      >
        {error && (
          <p role="alert" className="mb-3 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-3 rounded border border-[#b9e0cd] bg-good-bg px-2.5 py-1.5 text-[12px] text-good">
            {notice}
          </p>
        )}

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Recipient</span>
            <select
              value={contactId}
              disabled={!editable}
              onChange={(e) => {
                setContactId(e.target.value);
                setDirty(true);
              }}
              className={inputClass}
            >
              <option value="">Select a contact…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id} disabled={c.optedOut || !c.email}>
                  {c.name}
                  {c.role ? ` — ${c.role}` : ''}
                  {c.email ? ` (${c.email})` : ' — no email'}
                  {c.optedOut ? ' — OPTED OUT' : c.verificationStatus !== 'verified' ? ' — unverified' : ''}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-muted">
              Opted-out contacts cannot be selected. Unverified contacts can be selected but will
              block the send until verified.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Subject</span>
            <input
              value={subject}
              disabled={!editable}
              onChange={(e) => {
                setSubject(e.target.value);
                setDirty(true);
              }}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Body</span>
            <textarea
              value={body}
              disabled={!editable}
              rows={16}
              onChange={(e) => {
                setBody(e.target.value);
                setDirty(true);
              }}
              className={`${inputClass} font-mono text-[12px] leading-relaxed`}
            />
          </label>

          {editable && (
            <button
              type="button"
              disabled={busy !== null || !dirty}
              onClick={async () => {
                const ok = await post(
                  `/api/emails/${draft.id}`,
                  { subject, body, contactId: contactId || null },
                  'save',
                  'PATCH',
                );
                if (ok) {
                  setDirty(false);
                  setNotice('Draft saved.');
                }
              }}
              className={buttonClass('primary')}
            >
              {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
            </button>
          )}
        </div>
      </Card>

      <Card
        title="Send checklist"
        description={`Evaluated on the server ${new Date(gates.evaluatedAt).toISOString().slice(11, 16)} UTC. Re-checked again at the moment of sending.`}
        action={
          <span
            className={`rounded px-2 py-0.5 text-[11px] font-bold ${
              gates.sendable ? 'bg-good-bg text-good' : 'bg-critical-bg text-critical'
            }`}
          >
            {gates.sendable ? 'All checks passed' : `${blocking.length} blocking`}
          </span>
        }
      >
        <ul className="space-y-1.5">
          {gates.gates.map((gate) => (
            <li key={gate.key} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                  gate.status === 'pass' ? 'bg-good' : gate.status === 'warn' ? 'bg-high' : 'bg-critical'
                }`}
              >
                {gate.status === 'pass' ? '✓' : gate.status === 'warn' ? '!' : '×'}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-navy">
                  {gate.label}
                  <span className="sr-only"> — {gate.status}</span>
                </span>
                <span className={`block text-[12px] ${gate.status === 'fail' ? 'text-critical' : 'text-muted'}`}>
                  {gate.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>

        {warnings.length > 0 && (
          <p className="mt-3 rounded border border-[#f0d9a8] bg-high-bg px-2.5 py-1.5 text-[12px] text-high">
            {warnings.length} advisory item{warnings.length === 1 ? '' : 's'}. These do not block
            sending, but they are worth resolving.
          </p>
        )}
      </Card>

      <Card title="Workflow">
        <div className="space-y-3">
          {(permissions.submit || permissions.approve) && !sent && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-navy">Comment</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className={inputClass}
                placeholder="Required when rejecting; optional otherwise."
              />
            </label>
          )}

          <div className="flex flex-wrap gap-2">
            {permissions.submit && ['draft', 'changes_requested'].includes(draft.status) && (
              <button
                type="button"
                disabled={busy !== null || dirty}
                onClick={() =>
                  post('/api/approvals', { entityType: 'email', entityId: draft.id, action: 'submit', comment }, 'submit')
                }
                className={buttonClass('primary')}
                title={dirty ? 'Save your changes first' : undefined}
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}

            {permissions.approve && draft.status === 'needs_review' && (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    post('/api/approvals', { entityType: 'email', entityId: draft.id, action: 'approve', comment }, 'approve')
                  }
                  className={buttonClass('primary')}
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null || comment.trim().length === 0}
                  onClick={() =>
                    post('/api/approvals', { entityType: 'email', entityId: draft.id, action: 'reject', comment }, 'reject')
                  }
                  className={buttonClass('danger')}
                  title={comment.trim().length === 0 ? 'A comment is required when rejecting' : undefined}
                >
                  Request changes
                </button>
              </>
            )}

            {permissions.send && !sent && (
              <>
                <button
                  type="button"
                  disabled={busy !== null || !gates.sendable || !providerConnected}
                  onClick={() => post(`/api/emails/${draft.id}/send`, { manual: false }, 'send')}
                  className={buttonClass('primary')}
                  title={
                    !providerConnected
                      ? 'No email provider is connected. Use "Record as sent manually".'
                      : !gates.sendable
                        ? `${blocking.length} check(s) must pass before sending`
                        : undefined
                  }
                >
                  {busy === 'send' ? 'Sending…' : 'Send'}
                </button>

                <button
                  type="button"
                  disabled={busy !== null || !gates.sendable}
                  onClick={() => post(`/api/emails/${draft.id}/send`, { manual: true, note: comment || undefined }, 'manual')}
                  className={buttonClass('secondary')}
                  title={!gates.sendable ? `${blocking.length} check(s) must pass first` : undefined}
                >
                  {busy === 'manual' ? 'Recording…' : 'Record as sent manually'}
                </button>
              </>
            )}

            {permissions.cancel && !sent && draft.status !== 'cancelled' && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => post(`/api/emails/${draft.id}`, { status: 'cancelled' }, 'cancel', 'PATCH')}
                className={buttonClass('ghost')}
              >
                Cancel draft
              </button>
            )}
          </div>

          {!gates.sendable && !sent && (
            <p className="text-[12px] text-muted">
              Sending is blocked until every check above passes. This is enforced on the server, so
              it cannot be bypassed from this screen.
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
