'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, PageHeader, inputClass } from '@/components/ui';

export default function ImportLeadsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [mergeDuplicates, setMergeDuplicates] = useState(true);
  const [markAsDemoData, setMarkAsDemoData] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setError(null);
    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('dryRun', String(dryRun));
    formData.append('mergeDuplicates', String(mergeDuplicates));
    formData.append('markAsDemoData', String(markAsDemoData));

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Import failed.');
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Import Leads CSV"
        description="Bulk upload prospect lists (e.g. reference dataset) with header auto-mapping and strict duplicate detection."
        actions={
          <Link href="/leads" className="text-xs font-semibold text-blue hover:underline">
            ← Back to Leads
          </Link>
        }
      />

      {error && (
        <div className="rounded-lg border border-critical bg-critical-bg p-4 text-xs text-critical font-semibold">
          {error}
        </div>
      )}

      <Card title="CSV File & Import Options">
        <form onSubmit={handleImport} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-navy">Select CSV File *</label>
            <input
              type="file"
              accept=".csv,text/csv"
              required
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full rounded border border-line p-2 text-xs"
            />
            <p className="mt-1 text-[11px] text-muted">
              Accepts standard RFC 4180 CSV files up to 5,000 rows. Auto-maps columns for Organization, Website, Industry, Contact, Status/Issue, and Sales Offer.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 font-medium text-navy cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="rounded border-line"
              />
              Dry Run Mode (validate headers & duplicate matches without saving to database)
            </label>

            <label className="flex items-center gap-2 font-medium text-navy cursor-pointer">
              <input
                type="checkbox"
                checked={mergeDuplicates}
                onChange={(e) => setMergeDuplicates(e.target.checked)}
                className="rounded border-line"
              />
              Merge matching duplicate records (if unchecked, duplicate rows are skipped)
            </label>

            <label className="flex items-center gap-2 font-medium text-navy cursor-pointer">
              <input
                type="checkbox"
                checked={markAsDemoData}
                onChange={(e) => setMarkAsDemoData(e.target.checked)}
                className="rounded border-line"
              />
              Flag imported records as Demo Data (`isDemoData: true`)
            </label>
          </div>

          <div className="pt-3 flex justify-end">
            <button
              type="submit"
              disabled={loading || !file}
              className="rounded bg-blue px-4 py-2 font-semibold text-white hover:bg-navy disabled:opacity-50"
            >
              {loading ? 'Processing Import...' : dryRun ? 'Run Dry Run' : 'Execute Import'}
            </button>
          </div>
        </form>
      </Card>

      {result && (
        <Card title={`Import Results — Batch ${result.batchId.slice(0, 8)}`}>
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-5 gap-2 rounded bg-canvas p-3 text-center font-semibold">
              <div>
                <span className="block text-[11px] text-muted">Total Rows</span>
                <span className="text-base text-navy">{result.total}</span>
              </div>
              <div>
                <span className="block text-[11px] text-good">Created</span>
                <span className="text-base text-good">{result.created}</span>
              </div>
              <div>
                <span className="block text-[11px] text-blue">Merged</span>
                <span className="text-base text-blue">{result.merged}</span>
              </div>
              <div>
                <span className="block text-[11px] text-muted">Skipped</span>
                <span className="text-base text-muted">{result.skipped}</span>
              </div>
              <div>
                <span className="block text-[11px] text-critical">Errors</span>
                <span className="text-base text-critical">{result.errors}</span>
              </div>
            </div>

            {result.results && result.results.length > 0 && (
              <div className="max-h-60 overflow-y-auto divide-y divide-line-soft rounded border border-line">
                {result.results.map((r: any) => (
                  <div key={r.rowNumber} className="p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-navy">
                        Row {r.rowNumber}: {r.organizationName}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.status === 'created'
                            ? 'bg-good-bg text-good'
                            : r.status === 'merged'
                            ? 'bg-blue-100 text-blue'
                            : r.status === 'skipped'
                            ? 'bg-canvas text-muted'
                            : 'bg-critical-bg text-critical'
                        }`}
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </div>
                    {r.messages.map((m: string, idx: number) => (
                      <p key={idx} className="mt-0.5 text-[11px] text-muted pl-2 border-l-2 border-line">
                        {m}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <Link
                href="/leads"
                className="rounded bg-blue px-3 py-1.5 font-semibold text-white hover:bg-navy"
              >
                View Leads Directory →
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
