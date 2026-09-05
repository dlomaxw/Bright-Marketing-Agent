# BrightScope

Marketing audit, proposal and outreach workspace for **Bright Thoughts Services**.

Takes a prospect from intake → deterministic website audit → human-verified
findings → explainable score → audit report → costed proposal → approved
outreach email → CRM outcome.

---

## The rule everything else serves

> A client-facing claim may only exist if a deterministic check produced
> evidence for it, a human reviewed it, and the evidence is fresh.

That single sentence explains most of the design decisions in this codebase. If
you are about to change something and it makes that sentence less true, stop.

---

## Quick start

```bash
npm install
cp .env.example .env

# Generate a session secret and paste it into SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npx prisma generate
npx prisma db push
npm run db:seed          # roles, users, service catalogue, templates
npm run import:uma       # 1,529 real Ugandan manufacturers
npm run dev
```

Open <http://localhost:3000> and sign in with a seeded account
(password `BrightScope2026!Dev` — **change before any deployment**):

| Email | Role |
|---|---|
| `admin@brightthoughts.example` | Administrator |
| `auditor@brightthoughts.example` | Auditor / Strategist |
| `sales@brightthoughts.example` | Sales / Account Manager |
| `approver@brightthoughts.example` | Approver |
| `viewer@brightthoughts.example` | Viewer |

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run build:check` | Build into a separate directory — safe while `dev` is running |
| `npm run verify` | Typecheck + full test suite |
| `npm test` | Tests (70, across unit and integration) |
| `npm run worker` | Audit worker (production; `dev` drains the queue inline) |
| `npm run fixtures` | Local fixture sites for exercising the audit engine |
| `npm run db:seed` | Idempotent seed. Demo data is off unless `SEED_DEMO=true` |
| `npm run import:uma` | Import the UMA Business Directory |
| `npm run import -- <file.csv>` | Import a CSV lead list |
| `npm run demo:remove` | Delete every demonstration record |
| `npm run db:use postgres` | Switch the Prisma provider for deployment |

Verify the audit engine end to end:

```bash
npm run fixtures                    # terminal 1
npx tsx scripts/audit-smoke.ts      # terminal 2 — 12 failure modes
npm run demo:remove                 # the harness leaves fixture records behind
```

---

## Architecture in one diagram

```
 Layer 5  Outreach        emails, approvals, sending          <- blocked without L4
 Layer 4  Deliverables    reports, proposals                  <- blocked without L3
 Layer 3  Verification    human accept / edit / dismiss       <- blocked without L2
 Layer 2  Findings        rule-based classification + scoring <- blocked without L1
 Layer 1  Observations    deterministic checks + evidence     <- the only source of fact
 Layer 0  Records         organizations, contacts, profiles
```

Each layer may only consume the one below it. AI never writes into Layers 1 or
2; it reads 1–3 and drafts prose for 4–5, and its output is rejected if it cites
a finding that does not exist.

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Documentation

| Document | Contents |
|---|---|
| [HANDOVER.md](docs/HANDOVER.md) | **Start here.** Verified status, what changed, what remains |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, stack rationale, trust boundaries, data flow |
| [PERMISSIONS.md](docs/PERMISSIONS.md) | The role/action matrix, and the rules that cut across it |
| [AUDIT_CHECKS.md](docs/AUDIT_CHECKS.md) | Every check, its outcome vocabulary, severity and confidence |
| [USER_JOURNEYS.md](docs/USER_JOURNEYS.md) | Screen flow per role, and every failure path the UI must handle |
| [ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Missing inputs, decisions taken, credentials still required |

---

## What is deliberately not automated

These are not gaps. Each one is a decision, and each is enforced in code:

- **Verification.** Findings are never bulk-promoted to `manually_verified`. A
  person reviews each one. (`tests/safety-invariants.test.ts` fails the build if
  this regresses.)
- **Pricing.** No price is generated. The service catalogue ships empty and an
  authorised person enters the price book.
- **Sending.** `EMAIL_PROVIDER=console` by default: approved emails are recorded
  in the outbox and the activity log, and nothing is transmitted.
- **Business discovery.** Without a Google Places key, discovery says so and
  stops. It does not ask a language model to name businesses, because a model
  asked to do that produces plausible ones that do not exist.
- **Performance scores.** Core Web Vitals need an authorised data source. Without
  one they report as `unverifiable` — never estimated.

Every optional integration degrades to an explicit manual-review state. None
degrades to a guess.

---

## Testing

```bash
npm run verify        # typecheck + all tests
```

70 tests across 8 files:

- **Unit** — scoring arithmetic, AI output validation, the permissions matrix,
  normalisation and dedupe keys, the UMA directory parser, prospect
  qualification.
- **Integration** (`tests/integration/`) — the send gates and approval workflow
  exercised against real rows: unverified recipients, opt-outs, suppression,
  stale evidence, banned language, unresolved placeholders, self-approval,
  senior approval for sensitive sectors, duplicate sends and the frequency cap.
- **Structural** (`tests/safety-invariants.test.ts`) — a tripwire on the
  specific regression that has already happened once here.

Integration tests use their own SQLite database and never touch development
data.

---

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Prisma ·
Tailwind v4 · Zod · Vitest.

SQLite in development, PostgreSQL in production — the schema is
provider-portable (no native types, no database enums, JSON as text), so only
the `provider` line changes. See ARCHITECTURE.md §2.1 for why.
