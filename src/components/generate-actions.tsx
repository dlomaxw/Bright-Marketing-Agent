'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, buttonClass, money } from '@/components/ui';
import { EMAIL_STATUS_LABELS, type EmailStatus } from '@/lib/enums';

interface Version {
  id: string;
  version: number;
  status: string;
}

export function GenerateActions({
  organizationId,
  clientVisibleCount,
  reports,
  proposals,
  emails,
  permissions,
}: {
  organizationId: string;
  clientVisibleCount: number;
  reports: (Version & { createdAt: string })[];
  proposals: (Version & { total: number; currency: string })[];
  emails: (Version & { subject: string })[];
  permissions: { report: boolean; proposal: boolean; email: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const approvedReport = reports.find((r) => r.status === 'approved');
  const approvedProposal = proposals.find((p) => p.status === 'approved');

  async function generate(kind: 'report' | 'proposal' | 'email') {
    setBusy(kind);
    setError(null);
    setNotes([]);
    try {
      const endpoint =
        kind === 'report'
          ? `/api/organizations/${organizationId}/reports`
          : kind === 'proposal'
            ? `/api/organizations/${organizationId}/proposals`
            : `/api/organizations/${organizationId}/emails`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          kind === 'proposal'
            ? { reportId: approvedReport?.id ?? null }
            : kind === 'email'
              ? { reportId: approvedReport?.id ?? null, proposalId: approvedProposal?.id ?? null }
              : {},
        ),
      });
      const data = (await res.json()) as {
        error?: string;
        id?: string;
        warnings?: string[];
        aiIssues?: string[];
        excluded?: number;
      };

      if (!res.ok) {
        setError(data.error ?? `The ${kind} could not be generated.`);
        return;
      }
      const messages = [...(data.warnings ?? []), ...(data.aiIssues ?? [])];
      if (typeof data.excluded === 'number' && data.excluded > 0) {
        messages.push(
          `${data.excluded} finding(s) were excluded from the report. The appendix lists why.`,
        );
      }
      setNotes(messages);
      router.refresh();
      if (data.id && messages.length === 0) {
        router.push(kind === 'report' ? `/reports/${data.id}` : kind === 'proposal' ? `/proposals/${data.id}` : `/emails/${data.id}`);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  const statusTone = (status: string) =>
    status === 'approved'
      ? 'good'
      : status === 'rejected' || status === 'changes_requested'
        ? 'warn'
        : status === 'superseded' || status === 'cancelled'
          ? 'muted'
          : status === 'sent' || status === 'delivered' || status === 'replied'
            ? 'blue'
            : 'neutral';

  async function runAutopilot() {
    setBusy('autopilot');
    setError(null);
    setNotes([]);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/autopilot`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Autopilot failed.');
        return;
      }
      setNotes(data.stepsExecuted ?? ['Autopilot completed successfully.']);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title="Deliverables"
      description="Reports are built from verified, client-facing, fresh findings. Proposals are built from an approved report. Emails require both."
      action={
        <button
          type="button"
          onClick={runAutopilot}
          disabled={busy !== null}
          className={`${buttonClass('primary')} text-xs`}
        >
          {busy === 'autopilot' ? 'Running AI Autopilot…' : '⚡ AI Autopilot (Research → Report → Proposal)'}
        </button>
      }
    >
      {error && (
        <p role="alert" className="mb-3 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
          {error}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="mb-3 space-y-1 rounded border border-[#f0d9a8] bg-high-bg px-2.5 py-2 text-[12px] text-high">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {clientVisibleCount === 0 && (
        <p className="mb-3 rounded border border-blue-100 bg-medium-bg px-2.5 py-1.5 text-[12px] text-medium">
          No findings are approved for client-facing use yet. Verify findings and mark them
          client-facing before generating a report.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <DeliverableColumn
          title="Audit reports"
          emptyLabel="No report yet"
          items={reports.map((r) => ({
            id: r.id,
            label: `Version ${r.version}`,
            sub: new Date(r.createdAt).toISOString().slice(0, 10),
            status: r.status,
            href: `/reports/${r.id}`,
          }))}
          statusTone={statusTone}
          action={
            permissions.report ? (
              <button
                type="button"
                onClick={() => generate('report')}
                disabled={busy !== null || clientVisibleCount === 0}
                className={`${buttonClass('secondary')} w-full`}
              >
                {busy === 'report' ? 'Generating…' : reports.length ? 'New version' : 'Generate report'}
              </button>
            ) : null
          }
        />

        <DeliverableColumn
          title="Proposals"
          emptyLabel="No proposal yet"
          items={proposals.map((p) => ({
            id: p.id,
            label: `Version ${p.version}`,
            sub: money(p.total, p.currency),
            status: p.status,
            href: `/proposals/${p.id}`,
          }))}
          statusTone={statusTone}
          action={
            permissions.proposal ? (
              <button
                type="button"
                onClick={() => generate('proposal')}
                disabled={busy !== null || clientVisibleCount === 0}
                className={`${buttonClass('secondary')} w-full`}
              >
                {busy === 'proposal' ? 'Generating…' : proposals.length ? 'New version' : 'Generate proposal'}
              </button>
            ) : null
          }
        />

        <DeliverableColumn
          title="Outreach emails"
          emptyLabel="No draft yet"
          items={emails.map((e) => ({
            id: e.id,
            label: `Version ${e.version}`,
            sub: e.subject,
            status: EMAIL_STATUS_LABELS[e.status as EmailStatus] ?? e.status,
            href: `/emails/${e.id}`,
          }))}
          statusTone={statusTone}
          action={
            permissions.email ? (
              <button
                type="button"
                onClick={() => generate('email')}
                disabled={busy !== null}
                className={`${buttonClass('secondary')} w-full`}
              >
                {busy === 'email' ? 'Drafting…' : 'Draft email'}
              </button>
            ) : null
          }
        />
      </div>
    </Card>
  );
}

function DeliverableColumn({
  title,
  items,
  emptyLabel,
  action,
  statusTone,
}: {
  title: string;
  items: { id: string; label: string; sub: string; status: string; href: string }[];
  emptyLabel: string;
  action: React.ReactNode;
  statusTone: (status: string) => 'good' | 'warn' | 'muted' | 'blue' | 'neutral';
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>
      {items.length === 0 ? (
        <p className="mb-2 text-xs text-muted-soft">{emptyLabel}</p>
      ) : (
        <ul className="mb-2 space-y-1">
          {items.slice(0, 4).map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-start justify-between gap-2 rounded border border-line-soft px-2 py-1.5 hover:border-blue-100 hover:bg-blue-100/20"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-navy">{item.label}</span>
                  <span className="block truncate text-[11px] text-muted-soft">{item.sub}</span>
                </span>
                <Badge tone={statusTone(item.status)}>{item.status.replace(/_/g, ' ')}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {action}
    </div>
  );
}
