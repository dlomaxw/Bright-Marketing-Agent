import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, EmptyState, PageHeader, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Outreach Emails' };

export default async function EmailsPage() {
  await requirePageUser();

  const emails = await db.emailDraft.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: {
      organization: {
        select: {
          id: true,
          legalName: true,
        },
      },
      contact: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outreach Emails"
        description="Guard-checked outreach communications generated with strict evidence validation and separation of duties."
      />

      {emails.length === 0 ? (
        <EmptyState
          title="No outreach emails drafted yet"
          description="Emails are drafted from lead workspaces after completing report review."
          action={
            <Link
              href="/leads"
              className="inline-flex items-center gap-1 rounded bg-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy"
            >
              Browse Leads
            </Link>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Recipient / Organization</th>
                  <th className="px-4 py-2.5">Subject</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Updated At</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {emails.map((email) => (
                  <tr key={email.id} className="hover:bg-canvas/50">
                    <td className="px-4 py-3 font-semibold text-navy">
                      <div>{email.contact?.name ?? '(No contact name)'}</div>
                      <div className="text-[11px] font-normal text-muted">
                        {email.toEmail || email.contact?.email || '(No email address)'} — {email.organization.legalName}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[280px] truncate text-navy">
                      {email.subject || '(No subject set)'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          email.status === 'sent'
                            ? 'bg-good-bg text-good'
                            : email.status === 'approved'
                            ? 'bg-good-bg/60 text-good'
                            : email.status === 'cancelled'
                            ? 'bg-critical-bg text-critical'
                            : 'bg-high-bg text-high'
                        }`}
                      >
                        {email.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(email.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/emails/${email.id}`}
                        className="font-semibold text-blue hover:underline"
                      >
                        Open Workbench →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
