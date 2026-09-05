'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { buttonClass, inputClass } from '@/components/ui';

export function ContactForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    role: '',
    email: '',
    phone: '',
    whatsapp: '',
    isPrimary: false,
    sourceUrl: '',
    sourceNote: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/organizations/${organizationId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to add contact.');
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
        <label className="block font-semibold text-navy">Full Name *</label>
        <input
          type="text"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className={inputClass}
          placeholder="e.g. Sarah Namubiru"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block font-semibold text-navy">Role / Position</label>
          <input
            type="text"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            className={inputClass}
            placeholder="e.g. Marketing Director"
          />
        </div>
        <div>
          <label className="block font-semibold text-navy">Email Address</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className={inputClass}
            placeholder="e.g. sarah@example.ug"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block font-semibold text-navy">Phone Number</label>
          <input
            type="text"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className={inputClass}
            placeholder="e.g. +256 772 123456"
          />
        </div>
        <div>
          <label className="block font-semibold text-navy">WhatsApp Number</label>
          <input
            type="text"
            value={formData.whatsapp}
            onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
            className={inputClass}
            placeholder="e.g. +256 772 123456"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id="isPrimary"
          checked={formData.isPrimary}
          onChange={(e) => setFormData({ ...formData, isPrimary: e.target.checked })}
          className="h-4 w-4 rounded border-border text-blue focus:ring-blue"
        />
        <label htmlFor="isPrimary" className="font-semibold text-navy">
          Set as Primary Contact for Outreach
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-2">
        <div>
          <label className="block font-semibold text-navy">Source URL (Provenance)</label>
          <input
            type="url"
            value={formData.sourceUrl}
            onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })}
            className={inputClass}
            placeholder="https://company.ug/team"
          />
        </div>
        <div>
          <label className="block font-semibold text-navy">Source Note</label>
          <input
            type="text"
            value={formData.sourceNote}
            onChange={(e) => setFormData({ ...formData, sourceNote: e.target.value })}
            className={inputClass}
            placeholder="Obtained from public contact page"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-4">
        <Link href={`/leads/${organizationId}`} className={buttonClass('secondary')}>
          Cancel
        </Link>
        <button type="submit" disabled={loading} className={buttonClass('primary')}>
          {loading ? 'Saving...' : 'Save Contact'}
        </button>
      </div>
    </form>
  );
}
