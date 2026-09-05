import Link from 'next/link';
import Image from 'next/image';
import { requirePageUser } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { BRAND } from '@/config/brand';
import { ROLE_LABELS } from '@/lib/enums';
import { pendingApprovalCounts } from '@/server/approvals';
import { db } from '@/lib/db';
import { NavLink } from '@/components/nav-link';
import { SignOutButton } from '@/components/sign-out';
import { integrations, env } from '@/lib/env';
import { providerName } from '@/ai/provider';
import { AudioAssistant } from '@/components/audio-assistant';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const approvals = await pendingApprovalCounts();
  const overdueTasks = await db.task.count({
    where: { status: 'open', dueAt: { lt: new Date() } },
  });

  const sections: { label: string; items: { href: string; label: string; badge?: number }[] }[] = [
    {
      label: 'Work',
      items: [
        { href: '/', label: 'Dashboard' },
        { href: '/leads', label: 'Leads and prospects' },
        { href: '/pipeline', label: 'Pipeline' },
        { href: '/findings', label: 'Findings review' },
        { href: '/approvals', label: 'Approvals', badge: approvals.total },
        { href: '/tasks', label: 'Follow-ups and tasks', badge: overdueTasks },
      ],
    },
    {
      label: 'Deliverables',
      items: [
        { href: '/notebook', label: 'Notebook & Presentations' },
        { href: '/reports', label: 'Audit reports' },
        { href: '/proposals', label: 'Proposals' },
        { href: '/emails', label: 'Outreach emails' },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { href: '/analytics', label: 'Analytics' },
        ...(can(user.role, 'service.read') ? [{ href: '/services', label: 'Services and pricing' }] : []),
        ...(can(user.role, 'template.read') ? [{ href: '/templates', label: 'Templates' }] : []),
        ...(can(user.role, 'settings.write') || can(user.role, 'user.read')
          ? [{ href: '/settings', label: 'Settings' }]
          : []),
        { href: '/logs', label: 'Activity log' },
      ],
    },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[224px_1fr]">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <nav
        aria-label="Primary"
        className="flex flex-col border-b border-blue-700 bg-navy text-white lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r"
      >
        <div className="px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src={BRAND.logoPath}
              alt=""
              width={36}
              height={36}
              priority
              className="shrink-0 rounded bg-white p-0.5"
            />
            <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-gold">
              {BRAND.companyName}
            </span>
            <span className="mt-0.5 block text-lg font-semibold leading-tight">
              {BRAND.productName}
            </span>
            </span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {sections.map((section) => (
            <div key={section.label} className="mb-4">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href} badge={item.badge}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 px-4 py-3">
          <p className="truncate text-[13px] font-semibold">{user.name}</p>
          <p className="truncate text-[11px] text-white/50">{ROLE_LABELS[user.role]}</p>
          <SignOutButton />
        </div>
      </nav>

      <div className="flex min-w-0 flex-col">
        <AudioAssistant provider={providerName()} />

        {!integrations.emailProvider && (
          <div className="border-b border-[#f0d9a8] bg-high-bg px-5 py-1.5 text-[12px] text-high">
            <strong className="font-semibold">Outreach is in safe mode.</strong>{' '}
            <code className="rounded bg-white/60 px-1">EMAIL_PROVIDER={env.EMAIL_PROVIDER}</code> — approved
            emails are recorded in the outbox and activity log, and no message is transmitted to any
            recipient.
          </div>
        )}
        <main id="main" className="min-w-0 flex-1 px-5 py-6">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
