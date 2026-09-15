import { db } from '@/lib/db';
import { AppError } from '@/lib/api';

/**
 * Linking the documents an outreach email carries.
 *
 * A draft records *which* report and proposal it encloses, and the send path
 * renders those two rows into PDFs. If the row is not linked, nothing is
 * enclosed — and until this existed, nothing said so.
 *
 * That is not hypothetical. Of the first seven messages this application sent
 * to real businesses, four went out carrying nothing: the draft had been
 * created before the proposal existed, and the link is set at creation and was
 * never revisited. One of those companies has an approved proposal, written the
 * same minute as the draft, that they have still never seen. The send checklist
 * reported "No attachments" as a passing check, which is true and useless.
 *
 * So the link can now be set at any point before sending, from the draft
 * screen, and the checklist says something when an approved document exists and
 * is not enclosed.
 *
 * Only approved documents may be attached. An email is the moment a document
 * stops being internal, and attaching a draft would route around the approval
 * step entirely rather than merely skipping it.
 */

export interface AttachmentLink {
  reportId?: string | null;
  proposalId?: string | null;
}

export interface ResolvedLink {
  data: { reportId?: string | null; attachReport?: boolean; proposalId?: string | null; attachProposal?: boolean };
  notes: string[];
}

export async function resolveAttachmentLink(
  organizationId: string,
  input: AttachmentLink,
): Promise<ResolvedLink> {
  const data: ResolvedLink['data'] = {};
  const notes: string[] = [];

  if (input.reportId !== undefined) {
    if (!input.reportId) {
      data.reportId = null;
      data.attachReport = false;
    } else {
      const report = await db.report.findUnique({
        where: { id: input.reportId },
        select: { id: true, version: true, status: true, organizationId: true, deletedAt: true },
      });
      if (!report || report.deletedAt || report.organizationId !== organizationId) {
        throw new AppError('That report does not belong to this organization.', 400);
      }
      if (report.status !== 'approved') {
        throw new AppError(
          `Report v${report.version} is "${report.status}". Only an approved report can be attached to a message going to a client.`,
          409,
        );
      }
      data.reportId = report.id;
      data.attachReport = true;
      notes.push(`Audit report v${report.version} will be attached.`);
    }
  }

  if (input.proposalId !== undefined) {
    if (!input.proposalId) {
      data.proposalId = null;
      data.attachProposal = false;
    } else {
      const proposal = await db.proposal.findUnique({
        where: { id: input.proposalId },
        select: { id: true, version: true, status: true, organizationId: true, deletedAt: true },
      });
      if (!proposal || proposal.deletedAt || proposal.organizationId !== organizationId) {
        throw new AppError('That proposal does not belong to this organization.', 400);
      }
      if (proposal.status !== 'approved') {
        throw new AppError(
          `Proposal v${proposal.version} is "${proposal.status}". Only an approved proposal can be attached to a message going to a client.`,
          409,
        );
      }
      data.proposalId = proposal.id;
      data.attachProposal = true;
      notes.push(`Proposal v${proposal.version} will be attached.`);
    }
  }

  return { data, notes };
}

/** The approved documents this organization could enclose, newest first. */
export async function attachableDocuments(organizationId: string) {
  const [reports, proposals] = await Promise.all([
    db.report.findMany({
      where: { organizationId, deletedAt: null, status: 'approved' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, title: true },
    }),
    db.proposal.findMany({
      where: { organizationId, deletedAt: null, status: 'approved' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, title: true },
    }),
  ]);
  return { reports, proposals };
}
