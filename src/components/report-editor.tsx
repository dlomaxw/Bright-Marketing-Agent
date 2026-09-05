'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, buttonClass, inputClass } from '@/components/ui';
import { renderMarkdown } from '@/lib/markdown-preview';

interface Section {
  id: string;
  key: string;
  heading: string;
  body: string;
  included: boolean;
  editedByHuman: boolean;
}

export function ReportEditor({
  reportId,
  status,
  version,
  sections,
  permissions,
}: {
  reportId: string;
  status: string;
  version: number;
  sections: Section[];
  permissions: { edit: boolean; submit: boolean; approve: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');

  async function saveSection(section: Section) {
    const bodyText = drafts[section.id] ?? section.body;
    setBusy(section.id);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/sections/${section.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: bodyText }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'The section could not be saved.');
        return;
      }
      setEditingId(null);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleIncluded(section: Section) {
    setBusy(section.id);
    await fetch(`/api/reports/${reportId}/sections/${section.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ included: !section.included }),
    });
    setBusy(null);
    router.refresh();
  }

  async function workflow(action: 'submit' | 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType: 'report', entityId: reportId, action, comment }),
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

      <Card title="Workflow" description={`Version ${version} · status ${status.replace(/_/g, ' ')}`}>
        {(permissions.submit || permissions.approve) && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-semibold text-navy">Comment</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder="Required when requesting changes; optional otherwise."
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {permissions.submit && ['draft', 'changes_requested'].includes(status) && (
            <button type="button" disabled={busy !== null} onClick={() => workflow('submit')} className={buttonClass('primary')}>
              {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
            </button>
          )}
          {permissions.approve && status === 'pending_approval' && (
            <>
              <button type="button" disabled={busy !== null} onClick={() => workflow('approve')} className={buttonClass('primary')}>
                {busy === 'approve' ? 'Approving…' : 'Approve report'}
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
          {status === 'approved' && (
            <p className="text-[13px] text-good">
              Approved and locked. Generate a new version from the lead workspace to make changes.
            </p>
          )}
        </div>
      </Card>

      {sections.map((section) => {
        const isEditing = editingId === section.id;
        const value = drafts[section.id] ?? section.body;

        return (
          <Card
            key={section.id}
            title={
              <span className="flex items-center gap-2">
                {section.heading}
                {section.editedByHuman && <Badge tone="blue">edited</Badge>}
                {!section.included && <Badge tone="muted">excluded from export</Badge>}
              </span>
            }
            action={
              permissions.edit ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => toggleIncluded(section)}
                    disabled={busy !== null}
                    className="text-xs font-semibold text-blue hover:underline"
                  >
                    {section.included ? 'Exclude' : 'Include'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(isEditing ? null : section.id)}
                    className="text-xs font-semibold text-blue hover:underline"
                  >
                    {isEditing ? 'Cancel' : 'Edit'}
                  </button>
                </div>
              ) : undefined
            }
          >
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={value}
                  onChange={(e) => setDrafts({ ...drafts, [section.id]: e.target.value })}
                  rows={Math.min(28, Math.max(6, value.split('\n').length + 2))}
                  className={`${inputClass} font-mono text-[12px] leading-relaxed`}
                />
                <p className="text-[11px] text-muted">
                  Markdown: <code>#</code> headings, <code>-</code> bullets, <code>**bold**</code>,
                  and pipe tables. The same source produces both the PDF and the DOCX.
                </p>
                <button
                  type="button"
                  disabled={busy === section.id}
                  onClick={() => saveSection(section)}
                  className={buttonClass('primary')}
                >
                  {busy === section.id ? 'Saving…' : 'Save section'}
                </button>
              </div>
            ) : (
              <div
                className={`prose-report max-w-none ${section.included ? '' : 'opacity-50'}`}
                // Rendered from our own Markdown subset with all HTML escaped
                // first — see lib/markdown-preview.ts.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(section.body) }}
              />
            )}
          </Card>
        );
      })}
    </div>
  );
}
