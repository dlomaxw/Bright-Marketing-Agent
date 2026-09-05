'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, PageHeader, inputClass } from '@/components/ui';

export default function NewLeadPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    legalName: '',
    brandName: '',
    industry: '',
    country: 'Uganda',
    city: '',
    website: '',
    sector: 'standard',
    notes: '',
    contactName: '',
    contactRole: '',
    contactEmail: '',
    contactPhone: '',
    allowDuplicate: false,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: formData.legalName,
          brandName: formData.brandName || null,
          industry: formData.industry || null,
          country: formData.country,
          city: formData.city || null,
          website: formData.website || null,
          sector: formData.sector,
          notes: formData.notes || null,
          allowDuplicate: formData.allowDuplicate,
          contacts: formData.contactName
            ? [
                {
                  name: formData.contactName,
                  role: formData.contactRole || null,
                  email: formData.contactEmail || null,
                  phone: formData.contactPhone || null,
                },
              ]
            : [],
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.duplicates) {
          setDuplicates(data.duplicates);
          setError(data.error || 'A similar organization already exists.');
        } else {
          setError(data.error || 'Failed to create lead.');
        }
        setLoading(false);
        return;
      }

      router.push(`/leads/${data.id}`);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Add New Lead"
        description="Register a prospect organization for audit, scoring, and outreach pipeline management."
        actions={
          <Link href="/leads" className="text-xs font-semibold text-blue hover:underline">
            ← Back to Leads
          </Link>
        }
      />

      {error && (
        <div className="rounded-lg border border-critical bg-critical-bg p-4 text-xs text-critical">
          <p className="font-semibold">{error}</p>
          {duplicates.length > 0 && (
            <div className="mt-2 space-y-2">
              <p>Matching records found:</p>
              <ul className="list-disc pl-4">
                {duplicates.map((d: any) => (
                  <li key={d.organizationId}>
                    <Link href={`/leads/${d.organizationId}`} className="font-semibold underline">
                      {d.organizationName}
                    </Link>{' '}
                    (Matched on {d.matchedOn})
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => ({ ...prev, allowDuplicate: true }));
                  setTimeout(() => {
                    const btn = document.getElementById('submit-btn');
                    btn?.click();
                  }, 50);
                }}
                className="mt-2 rounded bg-high px-3 py-1 text-xs font-semibold text-white"
              >
                Create Separate Record Anyway
              </button>
            </div>
          )}
        </div>
      )}

      <Card title="Organization Details">
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-navy">Legal Name *</label>
            <input
              type="text"
              required
              value={formData.legalName}
              onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
              placeholder="e.g. Kampala Logistics Ltd"
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
                placeholder="e.g. Express Freight"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block font-semibold text-navy">Industry</label>
              <input
                type="text"
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                placeholder="e.g. Logistics & Transport"
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
                placeholder="https://example.co.ug"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block font-semibold text-navy">City / Location</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="e.g. Kampala"
                className={inputClass}
              />
            </div>
          </div>

          <hr className="border-line-soft" />

          <h3 className="font-semibold text-navy">Primary Contact (Optional)</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-navy">Contact Name</label>
              <input
                type="text"
                value={formData.contactName}
                onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                placeholder="e.g. Jane Doe"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block font-semibold text-navy">Role / Title</label>
              <input
                type="text"
                value={formData.contactRole}
                onChange={(e) => setFormData({ ...formData, contactRole: e.target.value })}
                placeholder="e.g. Marketing Director"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-navy">Email Address</label>
              <input
                type="email"
                value={formData.contactEmail}
                onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                placeholder="jane@example.co.ug"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block font-semibold text-navy">Phone Number</label>
              <input
                type="tel"
                value={formData.contactPhone}
                onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                placeholder="+256 700 000000"
                className={inputClass}
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <Link
              href="/leads"
              className="rounded border border-line px-3 py-1.5 font-semibold text-muted hover:bg-canvas"
            >
              Cancel
            </Link>
            <button
              id="submit-btn"
              type="submit"
              disabled={loading}
              className="rounded bg-blue px-4 py-1.5 font-semibold text-white hover:bg-navy disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Lead'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
