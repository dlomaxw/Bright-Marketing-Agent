import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePagePermission } from '@/server/auth/guard';
import { parseStringArray } from '@/lib/json';
import { PHASE_LABELS } from '@/lib/enums';
import { BRAND } from '@/config/brand';
import { renderMarkdown } from '@/lib/markdown-preview';
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
  const priceOnDiscussion = proposal.pricingBasis !== 'fixed';

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
        <header className="border-b-4 pb-8" style={{ borderColor: BRAND.gold }}>
          <div className="flex items-start justify-between">
            <div>
              {/*
                The mark itself, not the company name set in a colour. A client
                recognises the logo before they read anything, and this view is
                what gets shown on a screen in a meeting.
              */}
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={BRAND.logoPath}
                  alt={BRAND.companyName}
                  className="h-12 w-auto"
                />
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: BRAND.goldDark }}
                >
                  {BRAND.companyName}
                </span>
              </div>
              <h1
                className="mt-3 text-3xl font-bold tracking-tight"
                style={{ color: BRAND.navy }}
              >
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
              <p className="mt-1 text-sm font-semibold" style={{ color: BRAND.navy }}>
                {BRAND.companyName}
              </p>
              {/*
                The details a reader needs to reply, rather than a department
                name. "Marketing Audit & Digital Advisory Team" described no
                team that exists.
              */}
              <p className="text-slate-500">{BRAND.address}</p>
              <p className="text-slate-500">{BRAND.phones.join(' · ')}</p>
              <p className="text-slate-500">{BRAND.email}</p>
              <p className="text-slate-500">{BRAND.websites.join(' · ')}</p>
            </div>
          </div>
        </header>

        {/* Proposal Content Body */}
        <div className="mt-8 space-y-8 text-sm text-slate-700 leading-relaxed">
          {proposal.situation && (
            <section>
              <h2 className="text-lg font-bold border-b-2 pb-2 mb-3" style={{ color: BRAND.navy, borderColor: BRAND.gold }}>
                1. Client Situation & Opportunity
              </h2>
              <div className="proposal-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(proposal.situation) }} />
            </section>
          )}

          {proposal.objectives && (
            <section>
              <h2 className="text-lg font-bold border-b-2 pb-2 mb-3" style={{ color: BRAND.navy, borderColor: BRAND.gold }}>
                2. Strategic Objectives
              </h2>
              <div className="proposal-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(proposal.objectives) }} />
            </section>
          )}

          {proposal.solution && (
            <section>
              <h2 className="text-lg font-bold border-b-2 pb-2 mb-3" style={{ color: BRAND.navy, borderColor: BRAND.gold }}>
                3. Recommended Solution
              </h2>
              <div className="proposal-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(proposal.solution) }} />
            </section>
          )}

          {proposal.items.length > 0 && (
            <section>
              <h2 className="text-lg font-bold border-b-2 pb-2 mb-4" style={{ color: BRAND.navy, borderColor: BRAND.gold }}>
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

          {/*
            Investment. With price-on-discussion the work is still itemised —
            the client sees exactly what is proposed — but no figures appear.
            A table of "UGX 0" against every line reads as a quotation with
            mistakes in it, and a client could reasonably ask to be held to it.
          */}
          <section>
            <h2
              className="text-lg font-bold border-b-2 pb-2 mb-4"
              style={{ color: BRAND.navy, borderColor: BRAND.gold }}
            >
              5. {priceOnDiscussion ? 'Scope of Investment' : 'Commercial Investment Breakdown'}
            </h2>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead
                  className="font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: BRAND.navy }}
                >
                  <tr>
                    <th className="p-3">Service Module</th>
                    <th className="p-3">Phase</th>
                    <th className="p-3 text-center">Qty</th>
                    {!priceOnDiscussion && <th className="p-3 text-right">Unit Fee</th>}
                    {!priceOnDiscussion && <th className="p-3 text-right">Total</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {proposal.items.map((item) => (
                    <tr key={item.id}>
                      <td className="p-3 font-semibold" style={{ color: BRAND.navy }}>{item.name}</td>
                      <td className="p-3 text-slate-500">{PHASE_LABELS[item.phase] ?? item.phase}</td>
                      <td className="p-3 text-center text-slate-500">{item.quantity}</td>
                      {!priceOnDiscussion && (
                        <td className="p-3 text-right font-medium">{money(item.unitFee, proposal.currency)}</td>
                      )}
                      {!priceOnDiscussion && (
                        <td className="p-3 text-right font-semibold text-slate-900">
                          {money(item.lineTotal, proposal.currency)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {!priceOnDiscussion && (
                  <tfoot className="bg-slate-50 font-bold text-xs">
                    <tr>
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-slate-600">Subtotal</td>
                      <td className="p-3 text-right text-slate-900">{money(proposal.subtotal, proposal.currency)}</td>
                    </tr>
                    {proposal.discount > 0 && (
                      <tr>
                        <td colSpan={4} className="p-3 text-right uppercase tracking-wider text-slate-600">Discount</td>
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
                    <tr style={{ backgroundColor: BRAND.gold }}>
                      <td colSpan={4} className="p-3 text-right uppercase tracking-wider" style={{ color: BRAND.navy }}>
                        Total Investment
                      </td>
                      <td className="p-3 text-right font-extrabold" style={{ color: BRAND.navy }}>
                        {money(proposal.total, proposal.currency)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {priceOnDiscussion && (
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                Fees are agreed against the scope above rather than quoted from a list.{' '}
                {BRAND.companyName} will confirm the investment for each phase once the scope,
                timing and priorities are settled with you — so you pay for the work you actually
                want, in the order you want it.{' '}
                <strong>This document is a scope of work, not a quotation.</strong>
              </p>
            )}
          </section>

          <section className="pt-4 border-t border-slate-200">
            <h2 className="text-lg font-bold mb-3" style={{ color: BRAND.navy }}>6. Acceptance & Approval</h2>
            {/*
              Wording follows the pricing basis. Saying a client accepts a
              "commercial investment specified in this proposal" is wrong when
              the proposal deliberately specifies none, and a signature block
              that misdescribes what is being agreed is worse than none.
            */}
            <p className="text-xs text-slate-500 mb-6">
              {proposal.pricingBasis === 'fixed'
                ? 'By signing below, the client accepts the terms, scope, and commercial investment specified in this proposal.'
                : 'By signing below, the client accepts the scope of work set out above. Fees are agreed separately against that scope; this document is not a quotation.'}
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

          {/*
            The document closes the way it opened. A proposal is read, put
            down, and picked up again by whoever has to reply to it, and the
            reply details should not live only on page one.
          */}
          <footer
            className="mt-8 flex items-center justify-between gap-6 rounded-xl px-5 py-4 text-xs"
            style={{ backgroundColor: BRAND.navy, color: '#E2E8F0' }}
          >
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND.logoPath} alt={BRAND.companyName} className="h-9 w-auto" />
              <div>
                <p className="font-semibold" style={{ color: BRAND.gold }}>
                  {BRAND.companyName}
                </p>
                <p className="opacity-80">{BRAND.tagline}</p>
              </div>
            </div>
            <div className="text-right leading-relaxed opacity-90">
              <p>{BRAND.address}</p>
              <p>{BRAND.phones.join(' · ')}</p>
              <p>
                {BRAND.email} · {BRAND.websites.join(' · ')}
              </p>
            </div>
          </footer>
        </div>
      </article>
    </div>
  );
}
