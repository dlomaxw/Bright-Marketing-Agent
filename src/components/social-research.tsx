'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, buttonClass } from '@/components/ui';

/**
 * Triggers the deep review and audience pass, and shows the result honestly:
 * what was read, and — equally prominent — what could not be read and why.
 *
 * The "could not read" list is not an error state. Most social platforms only
 * expose follower counts and comments to a token the account owner has granted,
 * which a prospect has not. Showing that plainly is what stops an unverified
 * number reaching a client document.
 */

interface Audience {
  platform: string;
  available: boolean;
  reason?: string;
  metrics?: Record<string, unknown>;
}

interface Result {
  reviews: {
    available: boolean;
    rating: number | null;
    totalReviews: number | null;
    caveat?: string;
    analysis?: { mostRecentReviewAt?: string | null; recurringTerms?: string[] };
  } | null;
  audiences: Audience[];
  serviceVisibility: { clear: boolean | null; observations: string[] };
  findingsCreated: number;
  manualReviewNeeded: string[];
}

export function SocialResearch({
  organizationId,
  canRun,
}: {
  organizationId: string;
  canRun: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/reviews`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'The research pass could not be completed.');
        return;
      }
      setResult(data as Result);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Social and review research"
      description="Google reviews, audience statistics where a platform permits it, and how clearly the business states what it sells."
      action={
        <div className="flex gap-2">
          <a
            href={`/api/organizations/${organizationId}/research-brief?format=pdf`}
            className={`${buttonClass('secondary')} text-xs`}
          >
            Research brief (PDF)
          </a>
          {canRun && (
            <button type="button" onClick={run} disabled={busy} className={`${buttonClass('primary')} text-xs`}>
              {busy ? 'Researching…' : 'Run research'}
            </button>
          )}
        </div>
      }
    >
      {error && (
        <p role="alert" className="mb-3 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
          {error}
        </p>
      )}

      {!result && !error && (
        <p className="text-[12px] text-muted">
          Nothing has been researched in this session. The brief above reflects what is already recorded.
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone={result.findingsCreated > 0 ? 'blue' : 'muted'}>
              {result.findingsCreated} finding(s) recorded
            </Badge>
            {result.reviews?.available && (
              <>
                <Badge tone="neutral">
                  {result.reviews.rating !== null ? `${result.reviews.rating.toFixed(1)}★` : 'no rating'}
                </Badge>
                <Badge tone="neutral">{result.reviews.totalReviews ?? 0} review(s)</Badge>
              </>
            )}
            <Badge tone={result.serviceVisibility.clear === false ? 'warn' : result.serviceVisibility.clear ? 'good' : 'muted'}>
              services {result.serviceVisibility.clear === null ? 'not established' : result.serviceVisibility.clear ? 'clearly stated' : 'unclear'}
            </Badge>
          </div>

          {result.reviews?.analysis?.recurringTerms && result.reviews.analysis.recurringTerms.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Terms recurring across reviews
              </p>
              <p className="text-[12px] text-ink">{result.reviews.analysis.recurringTerms.join(', ')}</p>
            </div>
          )}

          {result.serviceVisibility.observations.length > 0 && (
            <ul className="space-y-1 text-[12px] text-ink">
              {result.serviceVisibility.observations.map((o, i) => (
                <li key={i}>• {o}</li>
              ))}
            </ul>
          )}

          {result.manualReviewNeeded.length > 0 && (
            <div className="rounded border border-[#f0d9a8] bg-high-bg px-2.5 py-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-high">
                Could not be read automatically — {result.manualReviewNeeded.length} item(s)
              </p>
              <ul className="space-y-1 text-[12px] text-high">
                {result.manualReviewNeeded.map((m, i) => (
                  <li key={i}>• {m}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-high">
                Complete these on the platform profile checklists. Nothing above has been estimated.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
