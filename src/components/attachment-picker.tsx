'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass, inputClass } from '@/components/ui';

/**
 * Choosing what an outreach email encloses.
 *
 * The link between a draft and its documents used to be set once, when the
 * draft was created, and never again. A draft written before the proposal
 * existed therefore enclosed nothing for ever, however long the approved
 * proposal sat beside it — and the send checklist reported "No attachments" as
 * a passing check rather than as the omission it was.
 *
 * Only approved documents are offered. Attaching a draft would route around the
 * approval step rather than merely skip it; the server refuses it either way.
 */

interface DocOption {
  id: string;
  version: number;
  title: string;
}

export function AttachmentPicker({
  draftId,
  reports,
  proposals,
  selectedReportId,
  selectedProposalId,
  editable,
}: {
  draftId: string;
  reports: DocOption[];
  proposals: DocOption[];
  selectedReportId: string | null;
  selectedProposalId: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [reportId, setReportId] = useState(selectedReportId ?? '');
  const [proposalId, setProposalId] = useState(selectedProposalId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = reportId !== (selectedReportId ?? '') || proposalId !== (selectedProposalId ?? '');

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/emails/${draftId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId: reportId || null, proposalId: proposalId || null }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError((payload?.data ?? payload)?.error ?? 'The attachments could not be changed.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (!editable) {
    return (
      <p className="text-[11px] text-muted-soft">
        {selectedReportId || selectedProposalId
          ? 'The enclosed documents are fixed once the draft is approved.'
          : 'This message encloses nothing, and cannot be changed at this stage.'}
      </p>
    );
  }

  if (reports.length === 0 && proposals.length === 0) {
    return (
      <p className="text-[11px] text-muted-soft">
        No approved report or proposal exists for this company yet, so there is nothing to enclose.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {reports.length > 0 && (
        <label className="block text-[11px] text-muted">
          Audit report
          <select
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
            className={`${inputClass} mt-1`}
          >
            <option value="">Do not enclose a report</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                v{r.version} — {r.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {proposals.length > 0 && (
        <label className="block text-[11px] text-muted">
          Proposal
          <select
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value)}
            className={`${inputClass} mt-1`}
          >
            <option value="">Do not enclose a proposal</option>
            {proposals.map((p) => (
              <option key={p.id} value={p.id}>
                v{p.version} — {p.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p role="alert" className="rounded border border-[#f3c6c3] bg-critical-bg px-2 py-1 text-[11px] text-critical">
          {error}
        </p>
      )}
      {saved && !dirty && <p className="text-[11px] text-muted">Saved.</p>}

      <button type="button" onClick={save} disabled={busy || !dirty} className={buttonClass('secondary')}>
        {busy ? 'Saving…' : 'Save attachments'}
      </button>
    </div>
  );
}
