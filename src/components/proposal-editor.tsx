'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, Notice, buttonClass, inputClass, money } from '@/components/ui';
import { PHASE_LABELS } from '@/lib/enums';

interface ProposalShape {
  id: string;
  version: number;
  status: string;
  currency: string;
  situation: string;
  objectives: string;
  solution: string;
  scope: string;
  deliverables: string;
  phases: string;
  timeline: string;
  clientResponsibilities: string;
  requiredAssets: string;
  discount: number;
  taxRate: number;
  paymentSchedule: string;
  assumptions: string;
  exclusions: string;
  changeControl: string;
  validUntil: string;
  acceptanceTerms: string;
  nextSteps: string;
  commercialsSetBy: string | null;
  subtotal: number;
  taxAmount: number;
  total: number;
}

interface Item {
  id: string;
  name: string;
  description: string | null;
  phase: string;
  quantity: number;
  unit: string;
  unitFee: number;
  lineTotal: number;
  justifications: { id: string; reference: string; observation_text: string }[];
}

const NARRATIVE_FIELDS: { key: keyof ProposalShape; label: string; rows: number }[] = [
  { key: 'situation', label: 'Client situation and verified opportunity', rows: 8 },
  { key: 'objectives', label: 'Project objectives', rows: 6 },
  { key: 'solution', label: 'Recommended solution', rows: 8 },
  { key: 'scope', label: 'Scope of work', rows: 5 },
  { key: 'deliverables', label: 'Deliverables', rows: 5 },
  { key: 'phases', label: 'Implementation phases', rows: 3 },
  { key: 'timeline', label: 'Timeline', rows: 3 },
  { key: 'clientResponsibilities', label: 'Client responsibilities', rows: 5 },
  { key: 'requiredAssets', label: 'Required assets and access', rows: 5 },
];

const COMMERCIAL_TEXT_FIELDS: { key: keyof ProposalShape; label: string; rows: number; hint?: string }[] = [
  { key: 'paymentSchedule', label: 'Payment schedule', rows: 3 },
  { key: 'assumptions', label: 'Assumptions', rows: 3 },
  { key: 'exclusions', label: 'Exclusions', rows: 3 },
  { key: 'changeControl', label: 'Change-control terms', rows: 3 },
  { key: 'acceptanceTerms', label: 'Acceptance', rows: 2 },
  { key: 'nextSteps', label: 'Next steps', rows: 2 },
];

export function ProposalEditor({
  proposal,
  items,
  permissions,
}: {
  proposal: ProposalShape;
  items: Item[];
  permissions: { edit: boolean; commercials: boolean; submit: boolean; approve: boolean };
}) {
  const router = useRouter();
  const [form, setForm] = useState(proposal);
  const [lines, setLines] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof ProposalShape>(key: K, value: ProposalShape[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const setLine = (id: string, patch: Partial<Item>) => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const liveSubtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitFee, 0);
  const liveAfterDiscount = Math.max(0, liveSubtotal - form.discount);
  const liveTax = Math.round(liveAfterDiscount * form.taxRate * 100) / 100;
  const liveTotal = liveAfterDiscount + liveTax;
  const unpriced = lines.filter((l) => l.unitFee <= 0);

  async function save(confirmCommercials: boolean) {
    setBusy(confirmCommercials ? 'confirm' : 'save');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(
            [...NARRATIVE_FIELDS, ...COMMERCIAL_TEXT_FIELDS].map((f) => [f.key, form[f.key]]),
          ),
          discount: form.discount,
          taxRate: form.taxRate,
          validUntil: form.validUntil || null,
          items: lines.map((l) => ({ id: l.id, quantity: l.quantity, unitFee: l.unitFee, phase: l.phase })),
          confirmCommercials,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'The proposal could not be saved.');
        return;
      }
      setDirty(false);
      setNotice(confirmCommercials ? 'Commercial terms confirmed.' : 'Proposal saved.');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  async function workflow(action: 'submit' | 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'proposal', entityId: proposal.id, action, comment }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) setError(data.error ?? 'The action failed.');
      else router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-[#b9e0cd] bg-good-bg px-2.5 py-1.5 text-[12px] text-good">{notice}</p>
      )}

      <Card title="Workflow" description={`Version ${proposal.version} · status ${proposal.status.replace(/_/g, ' ')}`}>
        {(permissions.submit || permissions.approve) && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-semibold text-navy">Comment</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={inputClass} />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {permissions.submit && ['draft', 'changes_requested'].includes(proposal.status) && (
            <button
              type="button"
              disabled={busy !== null || dirty}
              onClick={() => workflow('submit')}
              className={buttonClass('primary')}
              title={dirty ? 'Save your changes first' : undefined}
            >
              {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
            </button>
          )}
          {permissions.approve && proposal.status === 'pending_approval' && (
            <>
              <button type="button" disabled={busy !== null} onClick={() => workflow('approve')} className={buttonClass('primary')}>
                {busy === 'approve' ? 'Approving…' : 'Approve proposal'}
              </button>
              <button
                type="button"
                disabled={busy !== null || comment.trim().length === 0}
                onClick={() => workflow('reject')}
                className={buttonClass('danger')}
                title={comment.trim().length === 0 ? 'A comment is required when requesting changes' : undefined}
              >
                Request changes
              </button>
            </>
          )}
          {proposal.status === 'approved' && (
            <p className="text-[13px] text-good">Approved and locked.</p>
          )}
        </div>
      </Card>

      <Card
        title="Investment"
        description="Prices, discounts, tax and payment terms are entered by an authorised person. AI never writes these fields."
      >
        {!permissions.commercials ? (
          <Notice tone="info">
            Your role can read the commercial terms but not set them. Ask a sales or administrator
            user to confirm the fees.
          </Notice>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Service</th>
                    <th scope="col">Phase</th>
                    <th scope="col" className="text-right">Qty</th>
                    <th scope="col" className="text-right">Unit fee ({proposal.currency})</th>
                    <th scope="col" className="text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="font-medium text-navy">{line.name}</span>
                        {line.justifications.length > 0 && (
                          <span className="mt-0.5 block text-[11px] text-muted-soft">
                            addresses{' '}
                            {line.justifications.map((j, i) => (
                              <span key={j.id}>
                                {i > 0 && ', '}
                                <Link href={`/findings/${j.id}`} className="font-mono text-blue hover:underline">
                                  {j.reference}
                                </Link>
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td>
                        <select
                          value={line.phase}
                          onChange={(e) => setLine(line.id, { phase: e.target.value })}
                          className={`${inputClass} w-auto py-1 text-[12px]`}
                        >
                          {Object.entries(PHASE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={line.quantity}
                          onChange={(e) => setLine(line.id, { quantity: Number(e.target.value) })}
                          className={`${inputClass} w-20 py-1 text-right text-[12px]`}
                        />
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          min={0}
                          step="1000"
                          value={line.unitFee}
                          onChange={(e) => setLine(line.id, { unitFee: Number(e.target.value) })}
                          className={`${inputClass} w-32 py-1 text-right text-[12px] ${line.unitFee <= 0 ? 'border-critical' : ''}`}
                          aria-label={`Unit fee for ${line.name}`}
                        />
                      </td>
                      <td className="text-right numeric font-medium">
                        {money(line.quantity * line.unitFee, proposal.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {unpriced.length > 0 && (
              <p className="mt-2 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
                {unpriced.length} line(s) have no fee. Every line must be priced before this proposal
                can be submitted.
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-navy">Discount ({proposal.currency})</span>
                <input
                  type="number"
                  min={0}
                  value={form.discount}
                  onChange={(e) => set('discount', Number(e.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-navy">Tax rate</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.01"
                  value={form.taxRate}
                  onChange={(e) => set('taxRate', Number(e.target.value))}
                  className={inputClass}
                />
                <span className="mt-1 block text-[11px] text-muted">
                  As a decimal — 0.18 for 18%. TODO: confirm the applicable rate with finance.
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-navy">Valid until</span>
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => set('validUntil', e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>

            <dl className="mt-4 ml-auto max-w-xs space-y-1 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="numeric">{money(liveSubtotal, proposal.currency)}</dd></div>
              {form.discount > 0 && (
                <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="numeric">-{money(form.discount, proposal.currency)}</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="numeric">{money(liveTax, proposal.currency)}</dd></div>
              <div className="flex justify-between border-t border-line pt-1 font-semibold text-navy">
                <dt>Total</dt><dd className="numeric">{money(liveTotal, proposal.currency)}</dd>
              </div>
            </dl>

            <div className="mt-4 space-y-3">
              {COMMERCIAL_TEXT_FIELDS.map((field) => (
                <label key={String(field.key)} className="block">
                  <span className="mb-1 block text-xs font-semibold text-navy">{field.label}</span>
                  <textarea
                    value={String(form[field.key] ?? '')}
                    onChange={(e) => set(field.key, e.target.value as never)}
                    rows={field.rows}
                    className={inputClass}
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null || !dirty} onClick={() => save(false)} className={buttonClass('secondary')}>
                {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                disabled={busy !== null || unpriced.length > 0}
                onClick={() => save(true)}
                className={buttonClass('primary')}
                title={unpriced.length > 0 ? 'Price every line first' : undefined}
              >
                {busy === 'confirm' ? 'Confirming…' : 'Save and confirm commercial terms'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Confirming records your name and the time against these figures, and unlocks
              submission for approval.
            </p>
          </>
        )}
      </Card>

      {NARRATIVE_FIELDS.map((field) => (
        <Card key={String(field.key)} title={field.label}>
          {permissions.edit ? (
            <textarea
              value={String(form[field.key] ?? '')}
              onChange={(e) => set(field.key, e.target.value as never)}
              rows={field.rows}
              className={`${inputClass} font-mono text-[12px] leading-relaxed`}
            />
          ) : (
            <p className="whitespace-pre-wrap text-[13px] text-ink">
              {String(form[field.key] ?? '') || <span className="text-muted-soft">Not set</span>}
            </p>
          )}
        </Card>
      ))}

      {permissions.edit && (
        <button type="button" disabled={busy !== null || !dirty} onClick={() => save(false)} className={buttonClass('primary')}>
          {busy === 'save' ? 'Saving…' : dirty ? 'Save all changes' : 'Saved'}
        </button>
      )}
    </div>
  );
}
