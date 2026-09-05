# BrightScope — Application Architecture

Bright Thoughts Services · Marketing Audit & Outreach Intelligence Tool
Derived from *Marketing Audit & Outreach Intelligence Tool — Product Documentation v1.0*.

## 1. Guiding constraint

Everything in this architecture exists to enforce one rule:

> **A client-facing claim may only exist if a deterministic check produced evidence for it, a human reviewed it, and the evidence is fresh.**

This produces a strict layering. Each layer may only consume the layer below it, never skip it.

```
 Layer 5  Outreach        emails, approvals, sending          <- blocked without L4
 Layer 4  Deliverables    reports, proposals                  <- blocked without L3
 Layer 3  Verification    human accept / edit / dismiss       <- blocked without L2
 Layer 2  Findings        rule-based classification + scoring <- blocked without L1
 Layer 1  Observations    deterministic checks + evidence     <- the only source of fact
 Layer 0  Records         organizations, contacts, profiles
```

AI never writes into Layer 1 or Layer 2. It reads Layers 1-3 and drafts prose for Layers 4-5,
and its output is rejected if it references a finding ID that does not exist or is not approved
for client-facing use.

## 2. Stack and rationale

| Concern | Choice | Why |
|---|---|---|
| App framework | Next.js 15 (App Router) + React 19 + TypeScript | One deployable unit for UI + API; server components keep authorization on the server; matches the recommended stack. |
| Styling | Tailwind CSS v4 with a Bright Thoughts token layer | Data-dense agency UI, no template look, tokens keep brand colours in one place. |
| ORM | Prisma | Migrations, type safety, portable across SQLite/PostgreSQL. |
| Database | **SQLite in dev, PostgreSQL in production** | *Deviation from the brief, see 2.1.* |
| Auth | First-party session auth: scrypt password hash + signed httpOnly cookie (JOSE JWT) | No third-party dependency, no OAuth callback surface, full control of the role model and audit log. |
| Validation | Zod at every trust boundary | Request bodies, CSV rows, AI output and env vars all validated by the same primitives. |
| Audit engine | Node `fetch` (undici) + `cheerio` | Deterministic, no headless browser required for MVP checks; respects robots.txt, rate limits, timeouts. |
| Job queue | Database-backed queue table + in-process worker | Zero infrastructure for MVP; the `JobQueue` seam is where BullMQ/Redis drops in (see docs/PHASE2.md). |
| Documents | `docx` for DOCX, `pdfkit` for PDF | Pure Node, no Chromium in the deploy image. |
| AI | Anthropic Messages API behind a `ModelProvider` interface, with a deterministic template fallback | The app is fully functional with **no** API key; AI is an enhancement, never a dependency. |
| Tests | Vitest | Fast, TS-native, covers the scoring, audit, guard and AI-validation logic that carries the product risk. |

### 2.1 Database deviation

The brief specifies PostgreSQL. The target machine has neither PostgreSQL nor Docker, so a
Postgres-only build could not be run or verified during development.

Resolution: the Prisma schema is written to be **provider-portable** —

* no `@db.*` native type attributes,
* no database `enum` types (enums are `String` columns constrained by Zod + TypeScript unions),
* no scalar lists and no `Json` columns (JSON is stored as `String` and parsed through Zod).

`npm run db:use postgres` rewrites the single `provider` line and regenerates. The application
code is identical on both. Production deployment targets PostgreSQL as specified.

## 3. Process model

```
                        +--------------------------------------+
 Browser --HTTPS-->     |  Next.js server                      |
                        |                                      |
                        |  middleware   -> session cookie      |
                        |  server comps -> requirePermission() |
                        |  route hdlrs  -> Zod -> services     |
                        |                                      |
                        |  +--------------------------------+  |
                        |  | service layer (src/server/*)   |  |
                        |  |  the ONLY writer to the DB     |  |
                        |  |  emits Activity rows           |  |
                        |  +--------------------------------+  |
                        +-------+------------------+-----------+
                                |                  |
                        +-------v------+   +-------v---------+
                        | Prisma / DB  |   | Worker loop     |
                        |              |<--| claims AuditJob |--> public web
                        |              |   | runs checks     |    (rate-limited,
                        +--------------+   | writes evidence |     robots-aware)
                                           +-----------------+
```

The worker runs as `npm run worker` (a separate process in production) or, in development, as an
opportunistic in-process tick triggered by the audit API so a single `npm run dev` is enough.

## 4. Module map

```
src/
  app/                     routes (see docs/USER_JOURNEYS.md for the screen flow)
    (auth)/login
    (app)/...              authenticated shell: dashboard, leads, audits, findings,
                           reports, proposals, emails, pipeline, tasks, templates,
                           services, analytics, settings, logs
    api/...                route handlers (see docs/API.md)
  server/                  service layer - business rules, the only DB writer
    auth/                  session, password, guards
    leads/                 organizations, contacts, import, dedupe
    audit/                 run orchestration, job claiming
    findings/              classification, verification transitions
    scoring/               opportunity / confidence / relationship-risk
    reports/  proposals/  emails/  approvals/  crm/  admin/
  audit/                   the deterministic check engine
    registry.ts            catalogue of checks (see docs/AUDIT_CHECKS.md)
    checks/*.ts            one file per check family
    fetcher.ts             robots, rate limit, timeout, UA, redirect chain capture
  ai/                      provider adapter, prompt contract, output validator
  documents/               DOCX + PDF renderers
  lib/                     db, env, zod primitives, enums, dates, csv, errors
  components/              UI primitives + feature components
```

## 5. Trust boundaries

| Boundary | Control |
|---|---|
| Browser to server | Session cookie (httpOnly, SameSite=Lax, Secure in prod), CSRF origin check on mutations, Zod body validation. |
| Route to data | `requirePermission(user, action)` in every handler and every server component that reads sensitive data. Permissions are a matrix, not scattered role checks. |
| Server to public web | `fetcher.ts` only: robots.txt honoured, per-host concurrency 1, minimum interval between requests, request timeout, capped redirects, identifying User-Agent, GET/HEAD only. No auth bypass, no POST probing, no exploit attempts. |
| Server to AI | Allow-listed field projection. The model receives only approved findings and organization fields, never contact personal data. |
| AI to deliverable | `validateModelOutput()` rejects unknown finding IDs, banned phrases and missing required sections. Rejected output surfaces as `NEEDS_REVIEW`, never as prose. |
| Deliverable to send | `assertSendable()` - independent gates, all must pass (see docs/API.md). |

## 6. Data flow for the core journey

1. **Intake** — `POST /api/organizations` or `POST /api/import` -> dedupe on normalized domain,
   normalized name, email and E.164 phone -> `Organization` (+ `Contact`, `PlatformProfile`).
2. **Audit** — `POST /api/organizations/:id/audits` creates an `AuditRun` (status `queued`) and
   one `AuditJob` per selected check group. The worker claims jobs, calls `fetcher`, and writes
   `Observation` rows (raw, timestamped, with `Evidence` artifacts).
3. **Classification** — deterministic rules in `findings/classify.ts` turn observations into
   `Finding` rows with category, severity, confidence and a recommendation link. A check that could
   not run produces an observation with `outcome: 'unverifiable'` and **no** finding.
4. **Verification** — an auditor moves each finding through
   `auto_detected -> manually_verified | dismissed | needs_review`. Only `manually_verified`
   findings may be marked `clientVisible`.
5. **Scoring** — `scoring/opportunity.ts` recomputes the three scores from verified findings and
   stores a full component breakdown so the UI can explain every number.
6. **Report** — `reports/build.ts` assembles sections from client-visible findings; the editor
   allows per-section edits; submit -> approve -> immutable version.
7. **Proposal** — service modules matched from finding categories; all commercial fields
   (price, tax, discount, terms) are human-entered and AI-locked.
8. **Email** — drafted from approved report + proposal + at most two verified findings; passes the
   approval workflow; Send stays disabled until every gate is green.
9. **CRM** — stage changes, tasks, meetings, outcomes, all appended to `Activity`.

## 7. Freshness

Every `Finding` carries `observedAt`. `EVIDENCE_FRESHNESS_HOURS` (default 168) defines staleness.
Stale findings are excluded from report generation, flagged in the email approval checklist, and
block sending until re-checked. Imported legacy findings start at
`verificationStatus: 'needs_review'` with `requiresReverification: true` and can never be
client-visible until re-audited.

## 8. Observability and audit trail

`Activity` records actor, action, entity type/id, previous value, new value and reason for every
sensitive change (approvals, sends, stage changes, scoring weight edits, permission changes,
deletions). Rows are append-only; there is no delete path. Structured JSON logging via `lib/log.ts`
with request ids; errors carry a correlation id shown to the user.

## 9. Deletion and retention

Soft deletion (`deletedAt`) on organizations, contacts, reports, proposals and templates; hard
deletion is an admin-only, logged operation that also purges evidence artifacts. Retention windows
for evidence and raw observations are configurable in Settings and enforced by a scheduled
retention job.
