'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Badge, buttonClass } from '@/components/ui';
import { CHECK_GROUPS, CHECK_GROUP_LABELS, WEB_CHECK_GROUPS, type CheckGroup } from '@/lib/enums';

interface LatestRun {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  jobs: { group: string; status: string; error: string | null }[];
}

export function RunAuditPanel({
  organizationId,
  website,
  latestRun,
  canRun,
  hasProfiles,
}: {
  organizationId: string;
  website: string | null;
  latestRun: LatestRun | null;
  canRun: boolean;
  hasProfiles: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<CheckGroup[]>([...WEB_CHECK_GROUPS]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const running = latestRun?.status === 'queued' || latestRun?.status === 'running';

  // Poll only while a run is active, then stop.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => startTransition(() => router.refresh()), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  const toggle = (group: CheckGroup) =>
    setSelected((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]));

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/audits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groups: selected }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) setError(data.error ?? 'The audit could not be started.');
      else router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Website and platform audit"
      description={
        website
          ? `Deterministic checks against ${website}. Requests honour robots.txt, are rate limited, and never attempt authentication or security testing.`
          : 'No website is recorded, so the web checks cannot run. Add a website address to enable them.'
      }
      action={
        latestRun ? (
          <Badge
            tone={
              latestRun.status === 'completed'
                ? 'good'
                : latestRun.status === 'failed'
                  ? 'critical'
                  : latestRun.status === 'partial'
                    ? 'warn'
                    : 'blue'
            }
          >
            {running ? 'running…' : latestRun.status}
          </Badge>
        ) : undefined
      }
    >
      {error && (
        <p role="alert" className="mb-3 rounded border border-[#f3c6c3] bg-critical-bg px-2.5 py-1.5 text-[12px] text-critical">
          {error}
        </p>
      )}

      {canRun ? (
        <>
          <fieldset>
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Checks to run
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {CHECK_GROUPS.map((group) => {
                const needsWebsite = WEB_CHECK_GROUPS.includes(group);
                const disabled = (needsWebsite && !website) || (!needsWebsite && !hasProfiles);
                return (
                  <label
                    key={group}
                    className={`flex items-start gap-2 rounded border px-2 py-1.5 text-[12px] ${
                      disabled ? 'border-line-soft bg-canvas text-muted-soft' : 'border-line bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.includes(group)}
                      disabled={disabled}
                      onChange={() => toggle(group)}
                    />
                    <span>
                      <span className="block font-medium text-ink">{CHECK_GROUP_LABELS[group]}</span>
                      {!needsWebsite && (
                        <span className="block text-[10px] text-muted-soft">
                          {hasProfiles ? 'manual review checklist' : 'add profile URLs first'}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy || running || selected.length === 0}
              className={buttonClass('primary')}
            >
              {busy ? 'Starting…' : running ? 'Audit in progress…' : 'Run audit'}
            </button>
            <button
              type="button"
              onClick={() => setSelected([...WEB_CHECK_GROUPS])}
              className={buttonClass('ghost')}
            >
              Select website checks
            </button>
            <button type="button" onClick={() => setSelected([])} className={buttonClass('ghost')}>
              Clear
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted">
          Your role can view audit results but not start an audit.
        </p>
      )}

      {latestRun && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Latest run · {new Date(latestRun.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
            {pending && <span className="ml-2 font-normal normal-case text-muted-soft">refreshing…</span>}
          </p>
          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {latestRun.jobs.map((job) => (
              <li key={job.group} className="flex items-center justify-between gap-2 rounded bg-canvas px-2 py-1 text-[12px]">
                <span className="truncate text-ink">
                  {CHECK_GROUP_LABELS[job.group as CheckGroup] ?? job.group}
                </span>
                <Badge
                  tone={
                    job.status === 'completed'
                      ? 'good'
                      : job.status === 'failed'
                        ? 'critical'
                        : job.status === 'running' || job.status === 'claimed'
                          ? 'blue'
                          : 'muted'
                  }
                >
                  {job.status}
                </Badge>
              </li>
            ))}
          </ul>
          {latestRun.jobs.some((j) => j.error) && (
            <ul className="mt-2 space-y-1">
              {latestRun.jobs
                .filter((j) => j.error)
                .map((j) => (
                  <li key={j.group} className="text-[11px] text-critical">
                    <strong>{j.group}:</strong> {j.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
