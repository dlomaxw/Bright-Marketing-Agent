'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PIPELINE_STAGES, SECTORS, STAGE_LABELS } from '@/lib/enums';
import { inputClass } from '@/components/ui';

export function LeadEditForm({ org, tags }: { org: any; tags: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    legalName: org.legalName || '',
    brandName: org.brandName || '',
    industry: org.industry || '',
    country: org.country || 'Uganda',
    city: org.city || '',
    website: org.website || '',
    sector: org.sector || 'standard',
    stage: org.stage || 'new',
    notes: org.notes || '',
    tagsText: tags.join(', '),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const updatedTags = formData.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/organizations/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: formData.legalName,
          brandName: formData.brandName || null,
          industry: formData.industry || null,
          country: formData.country,
          city: formData.city || null,
          website: formData.website || null,
          sector: formData.sector,
          stage: formData.stage,
          notes: formData.notes || null,
          tags: updatedTags,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to update lead.');
        setLoading(false);
        return;
      }

      router.push(`/leads/${org.id}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      {error && (
        <div className="rounded-lg border border-critical bg-critical-bg p-3 text-xs text-critical">
          {error}
        </div>
      )}

      <div>
        <label className="block font-semibold text-navy">Legal Name *</label>
        <input
          type="text"
          required
          value={formData.legalName}
          onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block font-semibold text-navy">Brand Name</label>
          <input
            type="text"
            value={formData.brandName}
            onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block font-semibold text-navy">Industry</label>
          <input
            type="text"
            value={formData.industry}
            onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block font-semibold text-navy">Website URL</label>
          <input
            type="url"
            value={formData.website}
            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block font-semibold text-navy">City / Location</label>
          <input
            type="text"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block font-semibold text-navy">Pipeline Stage</label>
          <select
            value={formData.stage}
            onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
            className={inputClass}
          >
            {PIPELINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s] || s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-semibold text-navy">Sector Risk Tier</label>
          <select
            value={formData.sector}
            onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
            className={inputClass}
          >
            {SECTORS.map((sec) => (
              <option key={sec} value={sec}>
                {sec.charAt(0).toUpperCase() + sec.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block font-semibold text-navy">Tags (comma-separated)</label>
        <input
          type="text"
          value={formData.tagsText}
          onChange={(e) => setFormData({ ...formData, tagsText: e.target.value })}
          placeholder="e.g. priority, retail, uganda-100"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block font-semibold text-navy">Internal Notes</label>
        <textarea
          rows={4}
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className={inputClass}
        />
      </div>

      <div className="pt-2 flex items-center justify-end gap-3">
        <Link
          href={`/leads/${org.id}`}
          className="rounded border border-line px-3 py-1.5 font-semibold text-muted hover:bg-canvas"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue px-4 py-1.5 font-semibold text-white hover:bg-navy disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
