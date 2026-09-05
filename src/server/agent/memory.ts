import { db } from '@/lib/db';
import { getSetting } from '@/server/settings';
import { OPEN_STAGES, STAGE_LABELS, type PipelineStage } from '@/lib/enums';

/**
 * Agent memory.
 *
 * The assistant's memory is the database, queried live. It is deliberately not
 * a separate store of summarised "notes": a second copy would drift, and a
 * drifted memory is how an assistant starts asserting things that stopped being
 * true. Everything here is read straight from the same rows the screens render.
 *
 * Every fact returned carries enough context for the assistant to cite it —
 * organization, reference, timestamp — so it can say *how* it knows something.
 * Nothing in this module writes.
 */

export interface AgentClientSummary {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  city: string | null;
  stage: string;
  stageLabel: string;
  owner: string | null;
  opportunityScore: number | null;
  confidenceScore: number | null;
  relationshipRisk: number | null;
  findingsTotal: number;
  findingsVerified: number;
  findingsClientFacing: number;
  contactsTotal: number;
  contactsVerified: number;
  hasOptOut: boolean;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  opportunityValue: number | null;
  currency: string;
  isDemoData: boolean;
}

export interface AgentOutreachRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  subject: string;
  status: string;
  version: number;
  recipient: string | null;
  sentAt: string | null;
  channel: string | null;
  createdAt: string;
}

export interface AgentMemorySnapshot {
  generatedAt: string;
  portfolio: {
    totalClients: number;
    openPipeline: number;
    pipelineValue: number;
    won: number;
    lost: number;
  };
  work: {
    auditsRunning: number;
    findingsAwaitingVerification: number;
    reportsAwaitingApproval: number;
    proposalsAwaitingApproval: number;
    emailsAwaitingApproval: number;
    overdueTasks: number;
  };
  outreach: {
    sent: number;
    unsentDrafts: number;
    awaitingApproval: number;
    replied: number;
    suppressedContacts: number;
  };
  recentActivity: {
    action: string;
    entityType: string;
    organization: string | null;
    actor: string | null;
    occurredAt: string;
    reason: string | null;
  }[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Portfolio-level recall: what is going on right now, across everything. */
export async function agentMemorySnapshot(): Promise<AgentMemorySnapshot> {
  const now = new Date();

  const [
    totalClients,
    openOrgs,
    won,
    lost,
    auditsRunning,
    findingsAwaiting,
    reportsAwaiting,
    proposalsAwaiting,
    emailsAwaiting,
    overdueTasks,
    sent,
    unsentDrafts,
    replied,
    suppressedContacts,
    recentActivity,
  ] = await Promise.all([
    db.organization.count({ where: { deletedAt: null } }),
    db.organization.findMany({
      where: { deletedAt: null, stage: { in: OPEN_STAGES } },
      select: { opportunityValue: true },
    }),
    db.organization.count({ where: { deletedAt: null, stage: 'won' } }),
    db.organization.count({ where: { deletedAt: null, stage: 'lost' } }),
    db.auditRun.count({ where: { status: { in: ['queued', 'running'] } } }),
    db.finding.count({
      where: { deletedAt: null, verificationStatus: { in: ['auto_detected', 'needs_review'] } },
    }),
    db.report.count({ where: { deletedAt: null, status: 'pending_approval' } }),
    db.proposal.count({ where: { deletedAt: null, status: 'pending_approval' } }),
    db.emailDraft.count({ where: { deletedAt: null, status: 'needs_review' } }),
    db.task.count({ where: { status: 'open', dueAt: { lt: now } } }),
    db.emailDraft.count({ where: { status: { in: ['sent', 'delivered', 'replied'] } } }),
    db.emailDraft.count({
      where: { deletedAt: null, status: { in: ['draft', 'changes_requested'] } },
    }),
    db.emailDraft.count({ where: { status: 'replied' } }),
    db.contact.count({ where: { deletedAt: null, optedOut: true } }),
    db.activity.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 25,
      include: {
        organization: { select: { legalName: true, brandName: true } },
        actor: { select: { name: true } },
      },
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    portfolio: {
      totalClients,
      openPipeline: openOrgs.length,
      pipelineValue: openOrgs.reduce((sum, o) => sum + (o.opportunityValue ?? 0), 0),
      won,
      lost,
    },
    work: {
      auditsRunning,
      findingsAwaitingVerification: findingsAwaiting,
      reportsAwaitingApproval: reportsAwaiting,
      proposalsAwaitingApproval: proposalsAwaiting,
      emailsAwaitingApproval: emailsAwaiting,
      overdueTasks,
    },
    outreach: { sent, unsentDrafts, awaitingApproval: emailsAwaiting, replied, suppressedContacts },
    recentActivity: recentActivity.map((a) => ({
      action: a.action,
      entityType: a.entityType,
      organization: a.organization ? (a.organization.brandName ?? a.organization.legalName) : null,
      actor: a.actor?.name ?? null,
      occurredAt: a.occurredAt.toISOString(),
      reason: a.reason,
    })),
  };
}

/** Everything the assistant knows about one client. */
export async function agentClientSummary(organizationId: string): Promise<AgentClientSummary | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      owner: { select: { name: true } },
      contacts: { where: { deletedAt: null } },
      findings: { where: { deletedAt: null } },
    },
  });
  if (!org || org.deletedAt) return null;

  return {
    id: org.id,
    name: org.brandName ?? org.legalName,
    website: org.website,
    industry: org.industry,
    city: org.city,
    stage: org.stage,
    stageLabel: STAGE_LABELS[org.stage as PipelineStage] ?? org.stage,
    owner: org.owner?.name ?? null,
    opportunityScore: org.opportunityScore,
    confidenceScore: org.confidenceScore,
    relationshipRisk: org.relationshipRisk,
    findingsTotal: org.findings.length,
    findingsVerified: org.findings.filter((f) => f.verificationStatus === 'manually_verified').length,
    findingsClientFacing: org.findings.filter((f) => f.clientVisible).length,
    contactsTotal: org.contacts.length,
    contactsVerified: org.contacts.filter((c) => c.verificationStatus === 'verified').length,
    hasOptOut: org.contacts.some((c) => c.optedOut),
    lastContactedAt: iso(org.lastContactedAt),
    nextFollowUpAt: iso(org.nextFollowUpAt),
    opportunityValue: org.opportunityValue,
    currency: org.currency,
    isDemoData: org.isDemoData,
  };
}

/** Every client, for portfolio-level questions. */
export async function agentAllClients(limit = 200): Promise<AgentClientSummary[]> {
  const orgs = await db.organization.findMany({
    where: { deletedAt: null },
    orderBy: [{ opportunityScore: 'desc' }, { legalName: 'asc' }],
    take: limit,
    include: {
      owner: { select: { name: true } },
      contacts: { where: { deletedAt: null } },
      findings: { where: { deletedAt: null } },
    },
  });

  return orgs.map((org) => ({
    id: org.id,
    name: org.brandName ?? org.legalName,
    website: org.website,
    industry: org.industry,
    city: org.city,
    stage: org.stage,
    stageLabel: STAGE_LABELS[org.stage as PipelineStage] ?? org.stage,
    owner: org.owner?.name ?? null,
    opportunityScore: org.opportunityScore,
    confidenceScore: org.confidenceScore,
    relationshipRisk: org.relationshipRisk,
    findingsTotal: org.findings.length,
    findingsVerified: org.findings.filter((f) => f.verificationStatus === 'manually_verified').length,
    findingsClientFacing: org.findings.filter((f) => f.clientVisible).length,
    contactsTotal: org.contacts.length,
    contactsVerified: org.contacts.filter((c) => c.verificationStatus === 'verified').length,
    hasOptOut: org.contacts.some((c) => c.optedOut),
    lastContactedAt: iso(org.lastContactedAt),
    nextFollowUpAt: iso(org.nextFollowUpAt),
    opportunityValue: org.opportunityValue,
    currency: org.currency,
    isDemoData: org.isDemoData,
  }));
}

/**
 * Full outreach recall: what has been sent, what is still a draft, what was
 * approved, what bounced, what replied.
 */
export async function agentOutreachHistory(options: {
  organizationId?: string;
  status?: 'sent' | 'unsent' | 'awaiting_approval' | 'all';
  limit?: number;
} = {}): Promise<AgentOutreachRecord[]> {
  const status = options.status ?? 'all';

  const statusFilter =
    status === 'sent'
      ? { status: { in: ['sent', 'delivered', 'replied', 'bounced'] } }
      : status === 'unsent'
        ? { status: { in: ['draft', 'changes_requested', 'approved', 'scheduled'] } }
        : status === 'awaiting_approval'
          ? { status: 'needs_review' }
          : {};

  const drafts = await db.emailDraft.findMany({
    where: {
      deletedAt: null,
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      ...statusFilter,
    },
    orderBy: { updatedAt: 'desc' },
    take: options.limit ?? 50,
    include: { organization: { select: { legalName: true, brandName: true } } },
  });

  return drafts.map((d) => ({
    id: d.id,
    organizationId: d.organizationId,
    organizationName: d.organization.brandName ?? d.organization.legalName,
    subject: d.subject,
    status: d.status,
    version: d.version,
    recipient: d.toEmail,
    sentAt: iso(d.sentAt),
    channel: d.sendChannel,
    createdAt: d.createdAt.toISOString(),
  }));
}

/** Everything recorded against one client, for "what happened with X?". */
export async function agentClientTimeline(organizationId: string, limit = 40) {
  const activities = await db.activity.findMany({
    where: { organizationId },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    include: { actor: { select: { name: true } } },
  });

  return activities.map((a) => ({
    action: a.action,
    entityType: a.entityType,
    actor: a.actor?.name ?? 'System',
    occurredAt: a.occurredAt.toISOString(),
    reason: a.reason,
  }));
}

// ---------------------------------------------------------------------------
// Pitch prioritisation
// ---------------------------------------------------------------------------

export interface PitchCandidate {
  organizationId: string;
  name: string;
  website: string | null;
  industry: string | null;
  opportunityScore: number;
  confidenceScore: number | null;
  relationshipRisk: number | null;
  /** Verified, client-facing, fresh findings available to reference. */
  usableFindings: {
    id: string;
    reference: string;
    observation: string;
    severity: string;
    evidenceUrl: string | null;
  }[];
  contact: { id: string; name: string; role: string | null; email: string | null } | null;
  /** Why this one, in plain language, citing the actual numbers. */
  rationale: string[];
  /** What must happen before an email can be sent. Empty means ready. */
  blockers: string[];
  readyToPitch: boolean;
}

/**
 * Ranks who to approach next.
 *
 * This is the "which client can I pitch" question, answered from evidence
 * rather than intuition. A prospect is only `readyToPitch` when it has a
 * verified, fresh, client-facing finding to talk about AND a verified contact
 * who has not opted out — the same conditions the send gates enforce, so the
 * assistant never recommends something that would be blocked at the last step.
 */
export async function agentPitchCandidates(limit = 10): Promise<PitchCandidate[]> {
  const outreach = await getSetting('outreach.rules');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);
  const capSince = new Date(Date.now() - outreach.frequencyCapDays * 86_400_000);

  const orgs = await db.organization.findMany({
    where: {
      deletedAt: null,
      stage: { notIn: ['won', 'lost', 'nurture'] },
      opportunityScore: { not: null },
    },
    orderBy: { opportunityScore: 'desc' },
    take: 60,
    include: {
      contacts: { where: { deletedAt: null } },
      findings: { where: { deletedAt: null } },
      emailDrafts: {
        where: { sentAt: { gte: capSince }, status: { in: ['sent', 'delivered', 'replied'] } },
        select: { id: true },
      },
    },
  });

  const candidates: PitchCandidate[] = [];

  for (const org of orgs) {
    const usable = org.findings.filter(
      (f) =>
        f.verificationStatus === 'manually_verified' &&
        f.clientVisible &&
        !f.requiresReverification &&
        f.observedAt >= staleBefore,
    );

    const contactable = org.contacts.filter((c) => !c.optedOut && !!c.email);
    const verifiedContact =
      contactable.find((c) => c.verificationStatus === 'verified') ?? null;

    const blockers: string[] = [];
    const rationale: string[] = [];

    if (org.isDemoData) blockers.push('This is a seeded demonstration record and must not be contacted.');

    if (usable.length === 0) {
      const verifiedButStale = org.findings.filter(
        (f) => f.verificationStatus === 'manually_verified' && f.observedAt < staleBefore,
      ).length;
      const unreviewed = org.findings.filter((f) =>
        ['auto_detected', 'needs_review'].includes(f.verificationStatus),
      ).length;

      if (verifiedButStale > 0) {
        blockers.push(
          `${verifiedButStale} verified finding(s) are older than ${outreach.freshnessHours}h — re-run the audit before contacting.`,
        );
      } else if (unreviewed > 0) {
        blockers.push(`${unreviewed} finding(s) still need review and to be marked client-facing.`);
      } else {
        blockers.push('No findings yet — run an audit first.');
      }
    } else {
      rationale.push(
        `${usable.length} verified, fresh observation(s) to open with, including ${usable[0]!.reference}.`,
      );
    }

    if (org.contacts.length === 0) blockers.push('No contacts on record.');
    else if (contactable.length === 0) blockers.push('Every contact has opted out or has no email address.');
    else if (!verifiedContact) {
      blockers.push(
        `${contactable[0]!.name}'s details are unverified — confirm the address and its source first.`,
      );
    } else {
      rationale.push(`Verified contact: ${verifiedContact.name}${verifiedContact.role ? `, ${verifiedContact.role}` : ''}.`);
    }

    if (org.emailDrafts.length >= outreach.frequencyCapCount) {
      blockers.push(
        `Already contacted ${org.emailDrafts.length} time(s) in the last ${outreach.frequencyCapDays} days — at the frequency cap.`,
      );
    }

    if ((org.confidenceScore ?? 0) < 50 && usable.length > 0) {
      rationale.push(
        `Evidence confidence is ${org.confidenceScore} — worth verifying more before a senior conversation.`,
      );
    }
    if ((org.relationshipRisk ?? 0) >= 50) {
      rationale.push(`Relationship risk is ${org.relationshipRisk} — approach carefully.`);
    }
    if (org.opportunityScore !== null) {
      rationale.push(
        `Opportunity score ${org.opportunityScore}${org.opportunityScore >= 90 ? ' — a priority band' : ''}.`,
      );
    }

    candidates.push({
      organizationId: org.id,
      name: org.brandName ?? org.legalName,
      website: org.website,
      industry: org.industry,
      opportunityScore: org.opportunityScore ?? 0,
      confidenceScore: org.confidenceScore,
      relationshipRisk: org.relationshipRisk,
      usableFindings: usable.slice(0, 3).map((f) => ({
        id: f.id,
        reference: f.reference,
        observation: f.observation_text,
        severity: f.severity,
        evidenceUrl: f.evidenceUrl,
      })),
      contact: verifiedContact
        ? {
            id: verifiedContact.id,
            name: verifiedContact.name,
            role: verifiedContact.role,
            email: verifiedContact.email,
          }
        : null,
      rationale,
      blockers,
      readyToPitch: blockers.length === 0,
    });
  }

  // Ready-to-pitch first, then by score. A blocked high scorer is less useful
  // right now than a lower-scoring prospect you can actually contact today.
  return candidates
    .sort((a, b) => {
      if (a.readyToPitch !== b.readyToPitch) return a.readyToPitch ? -1 : 1;
      return b.opportunityScore - a.opportunityScore;
    })
    .slice(0, limit);
}
