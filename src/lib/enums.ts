/**
 * Every controlled vocabulary in the product, in one place.
 *
 * The database stores these as plain strings (portability contract, see
 * prisma/schema.prisma). These constants plus the Zod enums below are the only
 * thing keeping those columns honest, so nothing may write a status string that
 * is not declared here.
 */
import { z } from 'zod';

const tuple = <T extends readonly [string, ...string[]]>(v: T) => v;

// --- Roles ------------------------------------------------------------------

export const ROLES = tuple(['admin', 'auditor', 'sales', 'approver', 'viewer'] as const);
export type Role = (typeof ROLES)[number];
export const zRole = z.enum(ROLES);

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  auditor: 'Marketing Auditor / Strategist',
  sales: 'Sales / Account Manager',
  approver: 'Approver',
  viewer: 'Viewer',
};

// --- Pipeline ---------------------------------------------------------------

export const PIPELINE_STAGES = tuple([
  'new',
  'researching',
  'audit_in_progress',
  'needs_verification',
  'audit_completed',
  'report_ready',
  'proposal_ready',
  'awaiting_approval',
  'contacted',
  'follow_up_required',
  'replied',
  'meeting_scheduled',
  'proposal_presented',
  'negotiation',
  'won',
  'lost',
  'nurture',
] as const);
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export const zPipelineStage = z.enum(PIPELINE_STAGES);

export const STAGE_LABELS: Record<PipelineStage, string> = {
  new: 'New',
  researching: 'Researching',
  audit_in_progress: 'Audit in progress',
  needs_verification: 'Needs verification',
  audit_completed: 'Audit completed',
  report_ready: 'Report ready',
  proposal_ready: 'Proposal ready',
  awaiting_approval: 'Awaiting approval',
  contacted: 'Contacted',
  follow_up_required: 'Follow-up required',
  replied: 'Replied',
  meeting_scheduled: 'Meeting scheduled',
  proposal_presented: 'Proposal presented',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
};

/** Stages that count as open pipeline for value roll-ups. */
export const OPEN_STAGES: PipelineStage[] = PIPELINE_STAGES.filter(
  (s) => s !== 'won' && s !== 'lost' && s !== 'nurture',
) as PipelineStage[];

// --- Audit ------------------------------------------------------------------

export const CHECK_GROUPS = tuple([
  'availability',
  'cms',
  'seo',
  'content',
  'performance',
  'mobile',
  'conversion',
  'trust',
  'local',
  'social',
  'gbp',
] as const);
export type CheckGroup = (typeof CHECK_GROUPS)[number];
export const zCheckGroup = z.enum(CHECK_GROUPS);

export const CHECK_GROUP_LABELS: Record<CheckGroup, string> = {
  availability: 'Availability & hosting',
  cms: 'CMS hygiene',
  seo: 'Technical SEO',
  content: 'Content & information',
  performance: 'Performance & images',
  mobile: 'Mobile & accessibility',
  conversion: 'Conversion',
  trust: 'Trust',
  local: 'Local signals',
  social: 'Social media',
  gbp: 'Google Business',
};

/** Groups the deterministic web crawler can run without any external credential. */
export const WEB_CHECK_GROUPS: CheckGroup[] = [
  'availability',
  'cms',
  'seo',
  'content',
  'performance',
  'mobile',
  'conversion',
  'trust',
  'local',
];

export const OBSERVATION_OUTCOMES = tuple([
  'pass',
  'issue',
  'info',
  'unverifiable',
  'skipped',
] as const);
export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];
export const zObservationOutcome = z.enum(OBSERVATION_OUTCOMES);

export const OUTCOME_LABELS: Record<ObservationOutcome, string> = {
  pass: 'Passed',
  issue: 'Issue detected',
  info: 'Informational',
  unverifiable: 'Unable to verify automatically',
  skipped: 'Not run',
};

export const AUDIT_RUN_STATUSES = tuple([
  'queued',
  'running',
  'completed',
  'failed',
  'partial',
] as const);
export type AuditRunStatus = (typeof AUDIT_RUN_STATUSES)[number];

// --- Findings ---------------------------------------------------------------

export const FINDING_CATEGORIES = tuple([
  'availability',
  'cms',
  'seo',
  'content',
  'performance',
  'mobile',
  'accessibility',
  'conversion',
  'trust',
  'social',
  'local',
] as const);
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export const zFindingCategory = z.enum(FINDING_CATEGORIES);

export const SEVERITIES = tuple(['critical', 'high', 'medium', 'low', 'informational'] as const);
export type Severity = (typeof SEVERITIES)[number];
export const zSeverity = z.enum(SEVERITIES);

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 100,
  high: 75,
  medium: 45,
  low: 20,
  informational: 5,
};

export const CONFIDENCES = tuple(['high', 'medium', 'low'] as const);
export type Confidence = (typeof CONFIDENCES)[number];
export const zConfidence = z.enum(CONFIDENCES);

export const CONFIDENCE_WEIGHT: Record<Confidence, number> = { high: 100, medium: 60, low: 25 };

export const VERIFICATION_STATUSES = tuple([
  'auto_detected',
  'needs_review',
  'manually_verified',
  'dismissed',
  'fixed',
  'outdated',
] as const);
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const zVerificationStatus = z.enum(VERIFICATION_STATUSES);

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  auto_detected: 'Automatically detected',
  needs_review: 'Needs manual review',
  manually_verified: 'Manually verified',
  dismissed: 'Dismissed',
  fixed: 'Fixed',
  outdated: 'Outdated',
};

/**
 * The single gate for client-facing use. A finding may only appear in a report,
 * a proposal justification or an email if this returns true.
 */
export const CLIENT_ELIGIBLE_STATUSES: VerificationStatus[] = ['manually_verified'];

// --- Documents and outreach -------------------------------------------------

export const DOC_STATUSES = tuple([
  'draft',
  'pending_approval',
  'changes_requested',
  'approved',
  'rejected',
  'superseded',
] as const);
export type DocStatus = (typeof DOC_STATUSES)[number];

export const EMAIL_STATUSES = tuple([
  'draft',
  'needs_review',
  'changes_requested',
  'approved',
  'scheduled',
  'sent',
  'delivered',
  'bounced',
  'replied',
  'opted_out',
  'cancelled',
] as const);
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const zEmailStatus = z.enum(EMAIL_STATUSES);

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  draft: 'Draft',
  needs_review: 'Needs review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  sent: 'Sent',
  delivered: 'Delivered',
  bounced: 'Bounced',
  replied: 'Replied',
  opted_out: 'Opted out',
  cancelled: 'Cancelled',
};

// --- Platforms --------------------------------------------------------------

export const PLATFORMS = tuple([
  'facebook',
  'instagram',
  'linkedin',
  'x',
  'tiktok',
  'youtube',
  'google_business',
] as const);
export type Platform = (typeof PLATFORMS)[number];
export const zPlatform = z.enum(PLATFORMS);

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  x: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  google_business: 'Google Business Profile',
};

/**
 * A platform profile's own review state. Deliberately separate from
 * VERIFICATION_STATUSES: that vocabulary governs findings, and reusing it here
 * would make a reviewed profile look like a verified client-facing claim.
 */
export const PROFILE_REVIEW_STATUSES = tuple(['unverified', 'reviewed'] as const);
export type ProfileReviewStatus = (typeof PROFILE_REVIEW_STATUSES)[number];

// --- Misc -------------------------------------------------------------------

export const CONTACT_VERIFICATION = tuple(['unverified', 'verified', 'outdated'] as const);
export type ContactVerification = (typeof CONTACT_VERIFICATION)[number];

export const SECTORS = tuple([
  'standard',
  'government',
  'health',
  'education',
  'finance',
  'regulated',
] as const);
export type Sector = (typeof SECTORS)[number];
export const zSector = z.enum(SECTORS);

/** Sectors requiring a senior approver before outreach (product doc 2.1). */
export const SENSITIVE_SECTORS: Sector[] = [
  'government',
  'health',
  'education',
  'finance',
  'regulated',
];

export const CURRENCIES = tuple(['UGX', 'USD'] as const);
export type Currency = (typeof CURRENCIES)[number];
export const zCurrency = z.enum(CURRENCIES);

export const PHASES = tuple(['phase_1', 'phase_2', 'phase_3'] as const);
export const PHASE_LABELS: Record<string, string> = {
  phase_1: 'Phase 1 - Stabilise (0-30 days)',
  phase_2: 'Phase 2 - Improve (30-60 days)',
  phase_3: 'Phase 3 - Grow (60-90 days)',
};

export const TASK_TYPES = tuple([
  'follow_up',
  'call',
  'email',
  'research',
  'meeting_prep',
  'other',
] as const);
