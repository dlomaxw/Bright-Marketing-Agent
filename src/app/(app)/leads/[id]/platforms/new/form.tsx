'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PLATFORM_LABELS, PLATFORMS } from '@/lib/enums';
import { buttonClass, inputClass } from '@/components/ui';

export function PlatformForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    platform: 'facebook',
    url: '',
    handle: '',
    notes: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/organizations/${organizationId}/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to add platform profile.');
        setLoading(false);
        return;
      }

      router.push(`/leads/${organizationId}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border-subtle bg-card p-5 text-xs">
      {error && (
        <div className="rounded-lg border border-critical bg-critical-bg p-3 text-xs text-critical">
          {error}
        </div>
      )}

      <div>
        <label className="block font-semibold text-navy">Platform *</label>
        <select
          value={formData.platform}
          onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
          className={inputClass}
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p] || p}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block font-semibold text-navy">Profile URL *</label>
        <input
          type="url"
          required
          value={formData.url}
          onChange={(e) => setFormData({ ...formData, url: e.target.value })}
          className={inputClass}
          placeholder="https://facebook.com/company"
        />
      </div>

      <div>
        <label className="block font-semibold text-navy">Handle / Username</label>
        <input
          type="text"
          value={formData.handle}
          onChange={(e) => setFormData({ ...formData, handle: e.target.value })}
          className={inputClass}
          placeholder="@company"
        />
      </div>

      <div>
        <label className="block font-semibold text-navy">Notes</label>
        <textarea
          rows={3}
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className={inputClass}
          placeholder="Auditor notes on profile activity or reach..."
        />
      </div>

      <div className="flex items-center justify-end gap-3 pt-4">
        <Link href={`/leads/${organizationId}`} className={buttonClass('secondary')}>
          Cancel
        </Link>
        <button type="submit" disabled={loading} className={buttonClass('primary')}>
          {loading ? 'Saving...' : 'Save Platform Profile'}
        </button>
      </div>
    </form>
  );
}
