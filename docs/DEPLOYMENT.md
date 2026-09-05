# Deployment

## 1. Before anything else

This application sends email to real businesses on behalf of Bright Thoughts
Services. Four things must be true before the first message leaves the building,
and none of them is a code change:

1. **Legal review** of Ugandan data-protection and electronic-communications
   obligations for B2B outreach, plus a data-protection impact assessment.
2. **Brand details confirmed** in `src/config/brand.ts` and Settings — legal
   entity name, registered address, telephone, email, tax registration, sender
   signatures. These appear on every client-facing export.
3. **The price book entered** by an administrator. No price is generated; the
   catalogue ships empty by design.
4. **Sender deliverability**: SPF, DKIM and DMARC configured for the sending
   domain, and a deliverability test completed.

Until then, leave `EMAIL_PROVIDER=console`. Approved emails are recorded in the
outbox and the activity log, and nothing is transmitted.

---

## 2. Move to PostgreSQL

Development runs on SQLite; production targets PostgreSQL. The Prisma schema is
provider-portable, so only the provider changes.

```bash
npm run db:use postgres
```

Then set the connection string:

```
DATABASE_URL="postgresql://user:password@host:5432/brightscope?schema=public&sslmode=require"
```

Create the schema. For a first deployment:

```bash
npx prisma migrate deploy      # if you have committed migrations
# or, for an initial cut:
npx prisma db push
```

Then seed the reference data — roles, users, the service catalogue and
templates. Demo organizations are off unless `SEED_DEMO=true`:

```bash
npm run db:seed
```

**Change every seeded password immediately.** The seed prints them; they are
development credentials and must not survive contact with production.

---

## 3. Environment

Copy `.env.example` and fill it in. Two variables are required; everything else
degrades to an explicit manual-review state.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes** | PostgreSQL connection string |
| `SESSION_SECRET` | **yes** | 32+ bytes. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `APP_URL` | yes in prod | Used for the CSRF origin check |
| `EMAIL_PROVIDER` | — | `console` (default, sends nothing) or `smtp` |
| `EMAIL_FREQUENCY_CAP_DAYS` / `_COUNT` | — | Outreach frequency cap. Default: 1 message per 30 days per organization |
| `EVIDENCE_FRESHNESS_HOURS` | — | Default 168. Findings older than this block sending |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | — | Without a key, deterministic templates are used |
| `GOOGLE_PLACES_API_KEY` | — | Required for Google Business discovery |
| `PAGESPEED_API_KEY` | — | Without it, Core Web Vitals report `unverifiable` |
| `AUDIT_*` | — | Crawler politeness: timeout, interval, redirect cap, page budget |

Secrets belong in the platform's secret store, never in the image or the repo.

---

## 3b. Email sending — Spacemail over SMTP

### The Spaceship API cannot send email

Worth stating plainly, because the naming invites the assumption. The Spaceship
API (`https://spaceship.dev/api/v1/`, authenticated with `X-Api-Key` **and**
`X-Api-Secret`) manages domains, DNS records, transfers and nameservers. There
is no send endpoint.

Mail leaves this application over **SMTP to Spacemail**, Spaceship's email
hosting:

```
SMTP_HOST="mail.spacemail.com"
SMTP_PORT="465"                    # 465 implicit TLS, or 587 STARTTLS
SMTP_USER="you@yourdomain.com"     # the FULL mailbox address
SMTP_PASSWORD="..."
EMAIL_FROM_ADDRESS="you@yourdomain.com"
```

The Spaceship API is still worth configuring, for the step *before* sending:
reading the DNS records that decide whether mail is deliverable.

```
SPACESHIP_API_KEY="..."
SPACESHIP_API_SECRET="..."         # both are required
```

### Check readiness before switching the provider

```bash
npm run email:check                                   # configuration only
npm run email:check -- --domain yourdomain.com        # plus DNS
npm run email:check -- --test-connection              # authenticates, sends nothing
```

It reports MX, SPF, DKIM and DMARC as a receiving mail server would see them,
and flags the two failures that cause silent spam-foldering:

- **a From address on a different domain to the authenticated mailbox**
- **an SPF record that does not authorise the server you are actually sending
  from**

The second one is easy to miss. A domain whose SPF reads
`v=spf1 include:zohomail.com ~all` authorises Zoho and nothing else — sending
that domain's mail through Spacemail will fail SPF even though both are
correctly configured in isolation. Either add Spacemail to the SPF record, or
send from the mailbox the SPF already authorises.

### Failure behaviour

A delivery failure never looks like a delivered message. The draft stays unsent
with `failureReason` recorded, an `email.send_failed` activity is written, and
because the idempotency key is only set on success, a retry after the fix is
allowed.

---

## 4. Processes

Two processes, not one.

```bash
npm run build      # prisma generate && next build
npm start          # the web application
npm run worker     # the audit worker — a separate process
```

In development the API drains the audit queue inline, so `npm run dev` alone is
enough. **In production run the worker separately**, otherwise a long crawl
occupies a request thread.

The queue is the `AuditJob` table and claims are optimistic, so running several
workers is safe. The worker also reclaims jobs whose worker died and purges
expired sessions.

---

## 5. Egress and politeness

The audit engine makes outbound requests to prospect websites. It is deliberately
conservative, and the defaults should not be loosened without a reason:

- `robots.txt` honoured, with no bypass path in the code
- one in-flight request per host, with a minimum interval between requests
- request timeout, response size cap, capped redirects
- `GET` and `HEAD` only — no form submission, no authentication probing
- an identifying User-Agent with a contact URL

Set `AUDIT_USER_AGENT` to something that identifies the agency and gives a real
contact address, so a site owner who notices the traffic can reach you.

---

## 6. Health checks and monitoring

Worth alerting on:

| Signal | Why |
|---|---|
| `AuditJob` rows stuck in `claimed` for > 10 minutes | A worker died. The worker self-heals, but repeated occurrences mean something worse |
| `AuditRun` with status `failed` | The target site or the engine has a problem |
| `Activity` rows with action `permission.denied` | Someone is attempting actions their role does not allow |
| `EmailDraft` with status `bounced` | Deliverability or contact-quality problem |
| Growth in findings with `verificationStatus: 'needs_review'` | The review queue is not being worked |

Structured JSON logs go to stdout. Every API error carries a correlation id that
is also shown to the user, so a support report can be traced to a log line.

---

## 7. Backups and retention

- Back up the database on the platform's normal schedule. `Activity` is
  append-only and is the audit trail — it must be included.
- Evidence artifacts are stored inline for small items and by `storageRef` for
  large ones. If you enable object storage, back that up too.
- Retention windows for evidence and raw observations are configurable in
  Settings and enforced by a scheduled job.
- Soft-deleted records keep `deletedAt`. Hard deletion is admin-only and logged.

---

## 8. Post-deployment checklist

- [ ] `npm run verify` passes against the deployment branch
- [ ] `DATABASE_URL` points at PostgreSQL, `npm run db:use postgres` applied
- [ ] Seeded passwords changed; unused seed accounts suspended
- [ ] `SESSION_SECRET` set from the secret store, not the example file
- [ ] `APP_URL` matches the real origin (the CSRF check depends on it)
- [ ] Worker process running and picking up jobs
- [ ] `AUDIT_USER_AGENT` identifies the agency with a reachable contact
- [ ] Brand details and price book entered
- [ ] `EMAIL_PROVIDER` still `console` until legal and deliverability sign-off
- [ ] Backups verified by restoring one
