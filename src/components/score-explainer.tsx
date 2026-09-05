'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import type { ScoreResult } from '@/server/scoring';

/**
 * Shows exactly how each score was produced.
 *
 * The product documentation requires that a user can explain why a lead received
 * its priority, so this renders the weight, the component score, the weighted
 * contribution and the raw inputs behind every component - not a summary of them.
 */
export function ScoreExplainer({
  opportunityScore,
  confidenceScore,
  relationshipRisk,
  breakdownJson,
  scoredAt,
}: {
  opportunityScore: number | null;
  confidenceScore: number | null;
  relationshipRisk: number | null;
  breakdownJson: string | null;
  scoredAt: string | null;
}) {
  const [open, setOpen] = useState(false);

  let breakdown: ScoreResult | null = null;
  try {
    breakdown = breakdownJson ? (JSON.parse(breakdownJson) as ScoreResult) : null;
  } catch {
    breakdown = null;
  }

  if (opportunityScore === null) {
    return (
      <Card title="Scores">
        <p className="text-xs text-muted">
          Not scored yet. Scores are calculated from <strong>verified</strong> findings, so run an
          audit and verify at least one finding first.
        </p>
      </Card>
    );
  }

  const band =
    opportunityScore >= 95
      ? { label: 'Immediate outreach', detail: 'Personalised outreach within 24 hours', tone: 'bg-critical text-white' }
      : opportunityScore >= 90
        ? { label: 'Strong prospect', detail: 'Verify evidence and contact within 3 days', tone: 'bg-gold text-navy' }
        : opportunityScore >= 80
          ? { label: 'Good audit opportunity', detail: 'Add to the weekly outreach batch', tone: 'bg-blue text-white' }
          : { label: 'Maintenance / nurture', detail: 'Nurture, research or deprioritise', tone: 'bg-low-bg text-low' };

  const componentRows = breakdown
    ? ([
        ['Issue urgency', breakdown.components.urgency, breakdown.weights.urgency],
        ['Business impact', breakdown.components.impact, breakdown.weights.impact],
        ['Solution fit', breakdown.components.solutionFit, breakdown.weights.solutionFit],
        ['Organization value', breakdown.components.organizationValue, breakdown.weights.organizationValue],
        ['Contactability', breakdown.components.contactability, breakdown.weights.contactability],
      ] as const)
    : [];

  return (
    <Card
      title="Scores"
      description={scoredAt ? `Calculated ${new Date(scoredAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="text-center">
          <div className="text-3xl font-semibold tabular-nums text-navy">{opportunityScore}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Opportunity</div>
        </div>
        <div className="flex-1 space-y-1.5">
          <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${band.tone}`}>
            {band.label}
          </span>
          <p className="text-[11px] text-muted">{band.detail}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-canvas px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted">Evidence confidence</div>
          <div
            className={`text-lg font-semibold tabular-nums ${(confidenceScore ?? 0) < 50 ? 'text-high' : 'text-navy'}`}
          >
            {confidenceScore ?? '—'}
          </div>
        </div>
        <div className="rounded-md bg-canvas px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted">Relationship risk</div>
          <div
            className={`text-lg font-semibold tabular-nums ${(relationshipRisk ?? 0) >= 50 ? 'text-critical' : 'text-navy'}`}
          >
            {relationshipRisk ?? '—'}
          </div>
        </div>
      </div>

      {(confidenceScore ?? 100) < 50 && (
        <p className="mt-2 rounded border border-[#f0d9a8] bg-high-bg px-2 py-1.5 text-[11px] text-high">
          Evidence confidence is low. A high opportunity score does not make weak evidence usable —
          verify more findings before this lead is contacted.
        </p>
      )}

      {breakdown && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-3 text-xs font-semibold text-blue hover:underline"
          >
            {open ? 'Hide the calculation' : 'Show how this was calculated'}
          </button>

          {open && (
            <div className="mt-3 space-y-3">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="pb-1">Component</th>
                    <th className="pb-1 text-right">Score</th>
                    <th className="pb-1 text-right">Weight</th>
                    <th className="pb-1 text-right">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {componentRows.map(([label, component, weight]) => (
                    <tr key={label} className="border-b border-line-soft">
                      <td className="py-1.5">{label}</td>
                      <td className="py-1.5 text-right tabular-nums">{component.score}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted">
                        {Math.round(weight * 100)}%
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">
                        {Math.round(component.score * weight * 10) / 10}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-1.5 font-semibold" colSpan={3}>
                      Opportunity score
                    </td>
                    <td className="pt-1.5 text-right font-bold tabular-nums text-navy">
                      {breakdown.opportunity}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="space-y-2">
                {componentRows.map(([label, component]) => (
                  <details key={label} className="rounded border border-line-soft bg-canvas px-2.5 py-1.5">
                    <summary className="cursor-pointer text-[11px] font-semibold text-navy">
                      {label} — {component.score}
                    </summary>
                    <p className="mt-1 text-[11px] text-muted">{component.explanation}</p>
                    <ul className="mt-1 space-y-0.5">
                      {component.inputs.map((input, i) => (
                        <li key={i} className="flex justify-between text-[11px]">
                          <span className="text-muted">{input.label}</span>
                          <span className="font-medium tabular-nums text-ink">{input.value}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>

              <p className="text-[11px] text-muted-soft">
                {breakdown.countedFindings} verified finding(s) contributed. {breakdown.ignoredFindings}{' '}
                unverified or dismissed finding(s) were excluded — unverified findings never raise a
                score.
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
