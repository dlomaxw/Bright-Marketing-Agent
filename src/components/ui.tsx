import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import {
  CONFIDENCES,
  OUTCOME_LABELS,
  SEVERITIES,
  STAGE_LABELS,
  VERIFICATION_LABELS,
  type Confidence,
  type ObservationOutcome,
  type PipelineStage,
  type Severity,
  type VerificationStatus,
} from '@/lib/enums';

/** Shared presentational primitives. Server components unless marked otherwise. */

export function Card({
  title,
  description,
  action,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={clsx('rounded-lg border border-line bg-white shadow-[0_1px_2px_rgba(6,26,51,0.04)]', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-navy">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : undefined}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  href,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone?: 'neutral' | 'attention' | 'good' | 'critical';
}) {
  const toneClass = {
    neutral: 'text-navy',
    attention: 'text-high',
    good: 'text-good',
    critical: 'text-critical',
  }[tone];

  const inner = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', toneClass)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-soft">{hint}</div>}
    </>
  );

  const base =
    'block rounded-lg border border-line bg-white px-4 py-3 shadow-[0_1px_2px_rgba(6,26,51,0.04)]';

  return href ? (
    <Link href={href} className={clsx(base, 'transition hover:border-blue-100 hover:bg-blue-100/20')}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}

const badgeBase =
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold leading-tight whitespace-nowrap';

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'blue' | 'gold' | 'good' | 'warn' | 'critical' | 'muted';
  title?: string;
}) {
  const tones = {
    neutral: 'bg-low-bg text-low',
    blue: 'bg-medium-bg text-medium',
    gold: 'bg-[#fdf3e3] text-[#8a6600]',
    good: 'bg-good-bg text-good',
    warn: 'bg-high-bg text-high',
    critical: 'bg-critical-bg text-critical',
    muted: 'bg-[#f2f5f9] text-muted-soft',
  } as const;
  return (
    <span className={clsx(badgeBase, tones[tone])} title={title}>
      {children}
    </span>
  );
}

const SEVERITY_TONE: Record<Severity, Parameters<typeof Badge>[0]['tone']> = {
  critical: 'critical',
  high: 'warn',
  medium: 'blue',
  low: 'neutral',
  informational: 'muted',
};

export function SeverityBadge({ severity }: { severity: string }) {
  const s = (SEVERITIES as readonly string[]).includes(severity) ? (severity as Severity) : 'informational';
  return <Badge tone={SEVERITY_TONE[s]}>{s}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const c = (CONFIDENCES as readonly string[]).includes(confidence) ? (confidence as Confidence) : 'low';
  const tone = c === 'high' ? 'good' : c === 'medium' ? 'blue' : 'warn';
  return (
    <Badge tone={tone} title={`Evidence confidence: ${c}`}>
      {c} confidence
    </Badge>
  );
}

export function VerificationBadge({ status }: { status: string }) {
  const s = status as VerificationStatus;
  const tone =
    s === 'manually_verified'
      ? 'good'
      : s === 'dismissed'
        ? 'muted'
        : s === 'fixed'
          ? 'blue'
          : s === 'outdated'
            ? 'warn'
            : s === 'needs_review'
              ? 'warn'
              : 'neutral';
  return <Badge tone={tone}>{VERIFICATION_LABELS[s] ?? status}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const o = outcome as ObservationOutcome;
  const tone =
    o === 'issue' ? 'critical' : o === 'pass' ? 'good' : o === 'unverifiable' ? 'warn' : 'muted';
  return <Badge tone={tone}>{OUTCOME_LABELS[o] ?? outcome}</Badge>;
}

export function StageBadge({ stage }: { stage: string }) {
  const s = stage as PipelineStage;
  const tone =
    s === 'won' ? 'good' : s === 'lost' ? 'critical' : s === 'nurture' ? 'muted' : 'blue';
  return <Badge tone={tone}>{STAGE_LABELS[s] ?? stage}</Badge>;
}

export function ScorePill({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-muted-soft">Not scored</span>;
  }
  const tone =
    score >= 95 ? 'bg-critical text-white' : score >= 90 ? 'bg-gold text-navy' : score >= 80 ? 'bg-blue text-white' : 'bg-low-bg text-low';
  return (
    <span
      className={clsx('inline-block min-w-[34px] rounded px-1.5 py-0.5 text-center text-xs font-bold tabular-nums', tone)}
    >
      {score}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white/60 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-navy">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-xs text-muted">{breadcrumb}</div>}
        <h1 className="text-xl font-semibold text-navy">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'critical' | 'good';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-blue-100 bg-medium-bg text-medium',
    warn: 'border-[#f0d9a8] bg-high-bg text-high',
    critical: 'border-[#f3c6c3] bg-critical-bg text-critical',
    good: 'border-[#b9e0cd] bg-good-bg text-good',
  } as const;
  return (
    <div className={clsx('rounded-md border px-3 py-2.5 text-[13px]', tones[tone])} role="note">
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-0.5' : undefined}>{children}</div>
    </div>
  );
}

export function LinkButton({
  href,
  children,
  variant = 'secondary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return (
    <Link href={href} className={buttonClass(variant)}>
      {children}
    </Link>
  );
}

export function buttonClass(variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary'): string {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45';
  const variants = {
    primary: 'bg-navy text-white hover:bg-blue',
    secondary: 'border border-line bg-white text-navy hover:border-blue-100 hover:bg-blue-100/30',
    ghost: 'text-blue hover:bg-blue-100/40',
    danger: 'border border-[#f3c6c3] bg-critical-bg text-critical hover:bg-[#fbdedc]',
  } as const;
  return clsx(base, variants[variant]);
}

export function Field({
  label,
  hint,
  required,
  children,
  error,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-navy">
        {label}
        {required && <span className="ml-0.5 text-critical">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] font-medium text-critical">{error}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted-soft focus:border-blue focus:outline-none focus:ring-2 focus:ring-gold/40';

export function DefinitionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line-soft py-1.5 last:border-b-0">
      <dt className="w-40 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export function formatDate(value: Date | string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toISOString().slice(0, 10);
  return withTime ? `${date} ${d.toISOString().slice(11, 16)} UTC` : date;
}

export function relativeAge(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const hours = (Date.now() - d.getTime()) / 3600_000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function money(amount: number | null | undefined, currency = 'UGX'): string {
  if (amount === null || amount === undefined) return '—';
  return `${currency} ${amount.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
}
