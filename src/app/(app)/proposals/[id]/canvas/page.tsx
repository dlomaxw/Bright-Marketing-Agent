import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePagePermission } from '@/server/auth/guard';
import { parseStringArray } from '@/lib/json';
import { PHASE_LABELS } from '@/lib/enums';
import { BRAND } from '@/config/brand';
import { money, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.proposal.findUnique({ where: { id }, select: { title: true, version: true } });
  return { title: p ? `Canvas — ${p.title} v${p.version}` : 'Proposal Canvas' };
}

export default async function ProposalCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePagePermission('proposal.export');

  const proposal = await db.proposal.findUnique({
    where: { id },
    include: {
      organization: true,
      items: { orderBy: { sortOrder: 'asc' }, include: { serviceModule: true } },
    },
  });

  if (!proposal || proposal.deletedAt) notFound();

  const orgName = proposal.organization.brandName ?? proposal.organization.legalName;

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 print:bg-white print:p-0">
      {/* Top action bar (hidden during print) */}
      <div className="mx-auto max-w-4xl mb-6 flex items-center justify-between print:hidden">
        <Link href={`/proposals/${proposal.id}`} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
          ← Back to Proposal Editor
        </Link>
        <div className="flex items-center gap-3">
          <a
            href={`/api/proposals/${proposal.id}/export?format=pdf`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Download PDF
          </a>
          <a
            href={`/api/proposals/${proposal.id}/export?format=docx`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Download DOCX
          </a>
        </div>
      </div>

      {/* Canvas Printable Proposal Document */}
      <article className="mx-auto max-w-4xl rounded-2xl bg-white p-12 shadow-xl border border-slate-200 print:shadow-none print:border-none print:p-0">
        {/* Document Header */}
        <header className="border-b border-slate-200 pb-8">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-600">
                {BRAND.companyName}
              </span>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                Commercial Proposal
              </h1>
              <p className="mt-1 text-lg font-medium text-slate-600">{proposal.title}</p>
            </div>
            <div className="text-right text-xs text-slate-500 space-y-1">
              <p><strong className="text-slate-700">Proposal ID:</strong> {proposal.id.slice(0, 10)}</p>
              <p><strong className="text-slate-700">Version:</strong> v{proposal.version}</p>
              <p><strong className="text-slate-700">Date:</strong> {formatDate(proposal.createdAt)}</p>
              {proposal.validUntil && (
                <p><strong className="text-slate-700">Valid Until:</strong> {formatDate(proposal.validUntil)}</p>
              )}
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-slate-50 p-4 border border-slate-100 grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-400">Prepared For</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{orgName}</p>
              {proposal.organization.website && (
                <p className="text-slate-500">{proposal.organization.website}</p>
              )}
              {proposal.organization.city && (
                <p className="text-slate-500">{proposal.organization.city}, {proposal.organization.country}</p>
              )}
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-400">Prepared By</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{BRAND.companyName}</p>
              <p className="text-slate-500">Marketing Audit & Digital Advisory Team</p>
            </div>
          </div>
        </header>

        {/* Proposal Content Body */}
        <div className="mt-8 space-y-8 text-sm text-slate-700 leading-relaxed">
          {proposal.situation && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mb-3">
                1. Client Situation & Opportunity
              </h2>
              <p className="whitespace-pre-wrap">{proposal.situation}</p>
            </section>
          )}

          {proposal.objectives && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mb-3">
                2. Strategic Objectives
              </h2>
              <p className="whitespace-pre-wrap">{proposal.objectives}</p>
            </section>
          )}

          {proposal.solution && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mb-3">
                3. Recommended Solution
              </h2>
              <p className="whitespace-pre-wrap">{proposal.solution}</p>
            </section>
          )}

          {proposal.items.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mb-4">
                4. Scope of Deliverables & Services
              </h2>
              <div className="space-y-4">
                {proposal.items.map((item, idx) => {
                  const deliverables = parseStringArray(item.deliverablesJson);
                  return (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-900">
                          4.{idx + 1} {item.name}
                        </h3>
                        <span className="text-xs font-semibold rounded-full bg-slate-200 px-2.5 py-0.5 text-slate-700">
                          {PHASE_LABELS[item.phase] ?? item.phase}
                        </span>
                      </div>
                      {item.description && <p className="mt-2 text-slate-600">{item.description}</p>}
                      {deliverables.length > 0 && (
                        <ul className="mt-3 space-y-1 pl-5 list-disc text-xs text-slate-600">
                          {deliverables.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Investment Schedule Table */}
          <section>
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 mb-4">
              5. Commercial Investment Breakdown
            </h2>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-3">Service Module</th>
                    <th className="p-3">Phase</th>
                    <th className="p-3 text-center">Qty</th>
                    <th className="p-3 text-right">Unit Fee</th>
                    <th className="p-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {proposal.items.map((item) => (
                    <tr key={item.id}>
                      <td className="p-3 font-semibold text-slate-900">{item.name}</td>
                      <td className="p-3 text-slate-500">{PHASE_LABELS[item.phase] ?? item.phase}</td>
                      <td className="p-3 text-center font-medium">{item.quantity}</td>
                      <td className="p-3 text-right font-medium">{money(item.unitFee, proposal.currency)}</td>
                      <td className="p-3 text-right font-semibold text-slate-900">{money(item.lineTotal, proposal.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-300">
                  <tr>
                    <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-slate-600">Subtotal</td>
                    <td className="p-3 text-right text-slate-900">{money(proposal.subtotal, proposal.currency)}</td>
                  </tr>
                  {proposal.discount > 0 && (
                    <tr className="text-amber-700">
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider">Discount</td>
                      <td className="p-3 text-right">-{money(proposal.discount, proposal.currency)}</td>
                    </tr>
                  )}
                  {proposal.taxRate > 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-slate-600">
                        Tax ({Math.round(proposal.taxRate * 100)}%)
                      </td>
                      <td className="p-3 text-right text-slate-900">{money(proposal.taxAmount, proposal.currency)}</td>
                    </tr>
                  )}
                  <tr className="text-base text-slate-900 bg-slate-100">
                    <td colSpan={4} className="p-3 text-right uppercase tracking-wider">Grand Total</td>
                    <td className="p-3 text-right text-blue-700 font-extrabold">{money(proposal.total, proposal.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Terms & Signatures */}
          <section className="pt-4 border-t border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-3">6. Acceptance & Approval</h2>
            <p className="text-xs text-slate-500 mb-6">
              By signing below, the client accepts the terms, scope, and commercial investment specified in this proposal.
            </p>
            <div className="grid grid-cols-2 gap-8 pt-4">
              <div className="border-t border-slate-300 pt-3 text-xs">
                <p className="font-bold text-slate-900">For {orgName}:</p>
                <div className="mt-8 border-b border-dashed border-slate-300 pb-1" />
                <p className="mt-2 text-slate-500">Authorized Signature & Title</p>
                <p className="text-slate-400 mt-1">Date: ____________________</p>
              </div>
              <div className="border-t border-slate-300 pt-3 text-xs">
                <p className="font-bold text-slate-900">For {BRAND.companyName}:</p>
                <div className="mt-8 border-b border-dashed border-slate-300 pb-1" />
                <p className="mt-2 text-slate-500">Authorized Director / Strategist</p>
                <p className="text-slate-400 mt-1">Date: {formatDate(new Date())}</p>
              </div>
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
