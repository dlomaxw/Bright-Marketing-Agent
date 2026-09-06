'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '@/components/ui';

/**
 * The step between an approved proposal and a client receiving it.
 *
 * There is no "send" button on a proposal, and there should not be: a proposal
 * is a document, and what reaches a business is an email carrying it. That
 * email is a separate record with its own approval and its own eleven gates
 * checked at the moment of sending — recipient opted out, evidence still fresh,
 * frequency cap, approver different from submitter, and the rest.
 *
 * What was missing was any sign of that from here. Approving a proposal left
 * the page unchanged and the next action lived on a different screen, so the
 * workflow simply appeared to stop. This starts it and hands over to the
 * outreach draft, where the send actually happens.
 */
export function SendProposalAction({
  organizationId,
  proposalId,
  reportId,
}: {
  organizationId: string;
  proposalId: string;
  reportId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/emails`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proposalId, reportId }),
      });
      const payload = await res.json();
      const data = payload?.data ?? payload;

      if (!res.ok) {
        setError(data?.error ?? 'The outreach email could not be drafted.');
        return;
      }
      // Straight to the draft: the send checklist and the Send button are there.
      router.push(`/emails/${data.id}`);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <p
          role="alert"
          className="mb-2 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical"
        >
          {error}
        </p>
      )}
      <button type="button" onClick={prepare} disabled={busy} className={buttonClass('primary')}>
        {busy ? 'Preparing…' : 'Prepare outreach email →'}
      </button>
    </>
  );
}
