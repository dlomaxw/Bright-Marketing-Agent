import { BRAND } from '@/config/brand';
import { integrations } from '@/lib/env';
import { requirePageUser } from '@/server/auth/guard';
import { Card, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requirePageUser();

  const integrationStatuses = [
    {
      name: 'Anthropic Claude AI API',
      key: 'ANTHROPIC_API_KEY',
      active: integrations.ai,
      fallback: 'Deterministic templates (No fake claims generated)',
    },
    {
      name: 'Google PageSpeed Insights API',
      key: 'PAGESPEED_API_KEY',
      active: integrations.pagespeed,
      fallback: 'Reported as unverifiable (Never estimated)',
    },
    {
      name: 'Google Places API',
      key: 'GOOGLE_PLACES_API_KEY',
      active: integrations.googlePlaces,
      fallback: 'Manual checklist verification',
    },
    {
      name: 'Email Outbound Provider',
      key: 'EMAIL_PROVIDER',
      active: integrations.emailProvider,
      fallback: 'Safe Console Outbox mode (No real outbound sends)',
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Settings & System Status"
        description="Brand identity, environment provider setup, and external API key integration presence."
      />

      <Card title="Brand & Organization Identity">
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-4 border-b border-line-soft pb-2">
            <span className="text-muted">Company Name</span>
            <span className="font-semibold text-navy">{BRAND.companyName}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 border-b border-line-soft pb-2">
            <span className="text-muted">Product Name</span>
            <span className="font-semibold text-navy">{BRAND.productName}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <span className="text-muted">Current User Role</span>
            <span className="font-semibold text-navy uppercase">{user.role}</span>
          </div>
        </div>
      </Card>

      <Card title="Integration Presence & Fallbacks">
        <div className="space-y-4 text-xs">
          <p className="text-muted">
            BrightScope relies on explicit fallbacks. Missing keys degrade to honest manual checks or deterministic templates—never to guessed data.
          </p>
          <div className="divide-y divide-line-soft rounded border border-line">
            {integrationStatuses.map((item) => (
              <div key={item.key} className="flex items-center justify-between p-3">
                <div>
                  <div className="font-semibold text-navy">{item.name}</div>
                  <div className="text-[11px] text-muted">
                    Fallback: <span className="font-medium text-navy">{item.fallback}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      item.active ? 'bg-good-bg text-good' : 'bg-high-bg text-high'
                    }`}
                  >
                    {item.active ? 'CONNECTED' : 'MANUAL / SAFE MODE'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
