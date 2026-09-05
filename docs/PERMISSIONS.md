# Permissions Matrix

Roles: `admin`, `auditor`, `sales`, `approver`, `viewer`.

Implemented as a single data structure in `src/server/auth/permissions.ts`. Every API route and
every sensitive server component calls `requirePermission(user, action)`. There are no ad-hoc role
comparisons anywhere else in the codebase.

`Y` = allowed · `-` = denied · `own` = only rows where the user is the owner/assignee.

## Records

| Action | admin | auditor | sales | approver | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `org.read` | Y | Y | Y | Y | Y |
| `org.create` | Y | Y | Y | - | - |
| `org.update` | Y | Y | Y | - | - |
| `org.assign_owner` | Y | Y | Y | - | - |
| `org.delete` (soft) | Y | - | - | - | - |
| `org.purge` (hard) | Y | - | - | - | - |
| `org.import` | Y | Y | - | - | - |
| `org.export` | Y | Y | Y | Y | Y |
| `contact.read` | Y | Y | Y | Y | Y |
| `contact.write` | Y | Y | Y | - | - |
| `contact.verify` | Y | Y | Y | - | - |
| `contact.optout` | Y | Y | Y | Y | - |

## Audit and evidence

| Action | admin | auditor | sales | approver | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `audit.run` | Y | Y | - | - | - |
| `audit.read` | Y | Y | Y | Y | Y |
| `finding.read` | Y | Y | Y | Y | Y |
| `finding.verify` | Y | Y | - | - | - |
| `finding.edit` | Y | Y | - | - | - |
| `finding.dismiss` | Y | Y | - | - | - |
| `finding.recheck` | Y | Y | - | - | - |
| `finding.set_visibility` | Y | Y | - | - | - |
| `evidence.read` | Y | Y | Y | Y | Y |
| `evidence.delete` | Y | - | - | - | - |

Sales cannot alter original evidence (doc 2.0 restriction). Approvers cannot erase audit history —
there is no delete action for `Activity` for any role.

## Deliverables

| Action | admin | auditor | sales | approver | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `report.create` | Y | Y | - | - | - |
| `report.edit` | Y | Y | - | - | - |
| `report.submit` | Y | Y | Y | - | - |
| `report.approve` / `report.reject` | Y | - | - | Y | - |
| `report.export` | Y | Y | Y | Y | Y |
| `proposal.create` | Y | Y | Y | - | - |
| `proposal.edit` | Y | - | Y | - | - |
| `proposal.set_commercials` | Y | - | Y | - | - |
| `proposal.submit` | Y | Y | Y | - | - |
| `proposal.approve` / `proposal.reject` | Y | - | - | Y | - |
| `proposal.export` | Y | Y | Y | Y | Y |

`proposal.set_commercials` covers price, discount, tax, currency, payment terms and legal text.
The AI provider is never granted this action — commercial fields are stripped from every model
response before persistence.

## Outreach

| Action | admin | auditor | sales | approver | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `email.draft` | Y | Y | Y | - | - |
| `email.edit` | Y | Y | Y | - | - |
| `email.submit` | Y | Y | Y | - | - |
| `email.approve` / `email.reject` | Y | - | - | Y | - |
| `email.send` | Y | - | Y | Y | - |
| `email.cancel` | Y | Y | Y | Y | - |
| `suppression.read` | Y | Y | Y | Y | Y |
| `suppression.write` | Y | Y | Y | Y | - |

`email.send` requires the action **and** `assertSendable()` passing. An approver may send what they
approved only if `ALLOW_SELF_SEND_AFTER_APPROVAL` is enabled; the default separates the two.
Self-approval is always rejected: `approvedBy` may never equal `submittedBy`.

## CRM

| Action | admin | auditor | sales | approver | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `pipeline.read` | Y | Y | Y | Y | Y |
| `pipeline.update_stage` | Y | Y | Y | - | - |
| `task.read` | Y | Y | Y | Y | Y |
| `task.write` | Y | Y | Y | Y | - |
| `meeting.write` | Y | Y | Y | Y | - |
| `note.write` | Y | Y | Y | Y | - |

## Administration

| Action | admin | auditor | sales | approver | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `user.read` | Y | - | - | - | - |
| `user.write` | Y | - | - | - | - |
| `template.read` | Y | Y | Y | Y | Y |
| `template.write` | Y | - | - | - | - |
| `service.read` | Y | Y | Y | Y | Y |
| `service.write` | Y | - | - | - | - |
| `pricing.write` | Y | - | - | - | - |
| `scoring.write` | Y | - | - | - | - |
| `integration.write` | Y | - | - | - | - |
| `settings.write` | Y | - | - | - | - |
| `activity.read` | Y | Y | Y | Y | Y |
| `analytics.read` | Y | Y | Y | Y | Y |

## Cross-cutting rules

1. **Viewer is read-only.** The viewer role holds no action ending in
   `write|create|update|delete|send|approve|submit|run|import`.
2. **Separation of duties.** A user may not approve an artefact they submitted, regardless of role.
   Enforced in `approvals/guard.ts`, not in the UI.
3. **Sensitive sectors.** Organizations tagged `government`, `health`, `education`, `finance` or
   `regulated` require `approver` **and** `admin`-flagged `seniorApprover` on the user record
   (doc 2.1). Enforced in `assertSendable()`.
4. **Every denial is logged** with the attempted action and actor, so permission incidents appear in
   the operations metrics (doc 19).
