import type { Role } from '@/lib/enums';
import { ROLES } from '@/lib/enums';

/**
 * The permissions matrix. This is the single source of truth documented in
 * docs/PERMISSIONS.md - there are no role comparisons anywhere else in the app.
 *
 * Adding an action here without adding it to at least one role denies it to
 * everyone, which is the correct default.
 */

export const ACTIONS = [
  // records
  'org.read', 'org.create', 'org.update', 'org.assign_owner', 'org.delete', 'org.purge',
  'org.import', 'org.export',
  'contact.read', 'contact.write', 'contact.verify', 'contact.optout',
  // audit
  'audit.run', 'audit.read',
  'finding.read', 'finding.verify', 'finding.edit', 'finding.dismiss', 'finding.recheck',
  'finding.set_visibility',
  'evidence.read', 'evidence.delete',
  // deliverables
  'report.create', 'report.edit', 'report.submit', 'report.approve', 'report.reject',
  'report.export',
  'proposal.create', 'proposal.edit', 'proposal.set_commercials', 'proposal.submit',
  'proposal.approve', 'proposal.reject', 'proposal.export',
  // outreach
  'email.draft', 'email.edit', 'email.submit', 'email.approve', 'email.reject', 'email.send',
  'email.cancel',
  'suppression.read', 'suppression.write',
  // crm
  'pipeline.read', 'pipeline.update_stage',
  'task.read', 'task.write', 'meeting.write', 'note.write',
  // admin
  'user.read', 'user.write',
  'template.read', 'template.write',
  'service.read', 'service.write',
  'pricing.write', 'scoring.write', 'integration.write', 'settings.write',
  'activity.read', 'analytics.read',
] as const;

export type Action = (typeof ACTIONS)[number];

const READ_ONLY: Action[] = [
  'org.read', 'org.export', 'contact.read', 'audit.read', 'finding.read', 'evidence.read',
  'report.export', 'proposal.export', 'suppression.read', 'pipeline.read', 'task.read',
  'template.read', 'service.read', 'activity.read', 'analytics.read',
];

const MATRIX: Record<Role, Action[]> = {
  // Administrator holds every action; enumerated rather than wildcarded so a new
  // action is a deliberate grant, not an automatic one.
  admin: [...ACTIONS],

  auditor: [
    ...READ_ONLY,
    'org.create', 'org.update', 'org.assign_owner', 'org.import',
    'contact.write', 'contact.verify', 'contact.optout',
    'audit.run',
    'finding.verify', 'finding.edit', 'finding.dismiss', 'finding.recheck',
    'finding.set_visibility',
    'report.create', 'report.edit', 'report.submit',
    'proposal.create', 'proposal.submit',
    'email.draft', 'email.edit', 'email.submit', 'email.cancel',
    'suppression.write',
    'pipeline.update_stage', 'task.write', 'meeting.write', 'note.write',
  ],

  sales: [
    ...READ_ONLY,
    'org.create', 'org.update', 'org.assign_owner',
    'contact.write', 'contact.verify', 'contact.optout',
    'proposal.create', 'proposal.edit', 'proposal.set_commercials', 'proposal.submit',
    'report.submit',
    'email.draft', 'email.edit', 'email.submit', 'email.send', 'email.cancel',
    'suppression.write',
    'pipeline.update_stage', 'task.write', 'meeting.write', 'note.write',
  ],

  approver: [
    ...READ_ONLY,
    'report.approve', 'report.reject',
    'proposal.approve', 'proposal.reject',
    'email.approve', 'email.reject', 'email.send', 'email.cancel',
    'contact.optout', 'suppression.write',
    'task.write', 'meeting.write', 'note.write',
  ],

  viewer: [...READ_ONLY],
};

const SETS: Record<Role, Set<Action>> = Object.fromEntries(
  ROLES.map((r) => [r, new Set(MATRIX[r])]),
) as Record<Role, Set<Action>>;

export function can(role: Role | string | null | undefined, action: Action): boolean {
  if (!role) return false;
  const set = SETS[role as Role];
  return set ? set.has(action) : false;
}

export function actionsFor(role: Role): Action[] {
  return [...SETS[role]];
}

/** Used by tests and the settings screen to render the matrix. */
export function matrix(): Record<Role, Action[]> {
  return Object.fromEntries(ROLES.map((r) => [r, actionsFor(r)])) as Record<Role, Action[]>;
}
