# BrightScope — Handover & Status

Bright Thoughts Services · Marketing Audit & Outreach Intelligence Tool
Everything below was re-verified by running it, not carried over from a previous note.

---

## 1. What this is

An internal Next.js application implementing the *Marketing Audit & Outreach
Intelligence Tool* documentation. It takes a prospect from intake → deterministic
website audit → human-verified findings → explainable score → audit report →
costed proposal → approved outreach email → CRM outcome.

* **Location:** `App/marketing tool/brightscope/`
* **Stack:** Next.js 15 (App Router), React 19, TypeScript strict, Prisma,
  Tailwind v4, Zod, Vitest.

### The rule the whole codebase enforces

> A client-facing claim may only exist if a deterministic check produced
> evidence for it, a human reviewed it, and the evidence is fresh.

---

## 2. Verified status

Every line here was produced by running the command.

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | **clean** |
| Tests | `npm run verify` | **70 passed / 8 files** (19 behavioural gate tests) |
| Production build | `npm run build:check` | **compiled; 28 pages, 25 API routes** |
| Audit engine | `npx tsx scripts/audit-smoke.ts` | **12/12 fixture cases** |
| Real-site audit | UMA member site | **16 real findings, gate held** |
| Seed | `npm run db:seed` | idempotent; demo data off by default |
| App in a browser | `npm run dev` + walkthrough | **login, dashboard, leads, finding review, verification, agent all working** |

### The real-site run

`A.J. PRINTING & PACKAGING LTD` (`ajprintinguganda.com`), a real UMA member:

* 51 observations — 16 issue, 26 pass, 5 unverifiable, 1 skipped
* Genuine findings including a publicly served WordPress `/sample-page/` and an
  exposed `/readme.html`
* **Every finding came back `auto_detected`, `clientVisible=false`**, and
  confidence scored **0** — unverified findings do not inflate a score. The
  verification gate holds against real data.

---

## 3. Three critical defects found and fixed this session

These had shipped and were silently defeating the product's central rule.

### 3.1 Autopilot auto-verified every finding

`api/organizations/[id]/autopilot/route.ts` ran:

```ts
await db.finding.updateMany({
  where: { verificationStatus: { in: ['auto_detected', 'needs_review'] } },
  data: { verificationStatus: 'manually_verified', clientVisible: true },
});
```

That recorded machine output as human-reviewed, published unreviewed claims to
clients, and bypassed the imported-data re-verification block — so seeded
fictional findings could have reached a client report.

**Fixed:** autopilot now stops at the verification gate, reports how many
findings await review, and generates a report or proposal only from findings a
person has already verified and marked client-facing.

### 3.2 Uganda research did the same thing

`server/leads/uganda-research.ts` contained the identical bulk promotion.
**Fixed** the same way.

### 3.3 Uganda research fabricated prospects

It asked an LLM for "realistic Ugandan business prospects" — names, domains and
**telephone numbers** — and wrote them into the prospect table with
`isDemoData: false`. An ungrounded model cannot do web research; it generates
plausible companies. A fabricated Ugandan phone number may belong to a real
person.

**Fixed:** the model is now asked for **candidate domains only**, explicitly
told never to invent one and that an empty list is preferred, and explicitly
told not to return phone numbers, emails or addresses. Every candidate is then
**verified by actually fetching it** — a domain that does not respond is
discarded and never becomes a prospect. The recorded company name is read from
the site's own page title, not the model's guess. Analyst-supplied domains
(`candidateDomains`) bypass the model entirely and are the preferred path.

### Regression guard

`tests/safety-invariants.test.ts` (7 tests) now fails the build if any of this
returns. It parses `data: { … }` write blocks — so it distinguishes a legitimate
`where` filter from an actual assignment — and asserts:

* only the findings endpoint may assign `manually_verified`
* only the findings endpoint may set `clientVisible: true`
* no bulk `updateMany` promotes findings (demotion stays allowed)
* the agent's memory module contains no database writes
* sending always re-evaluates the gates
* no module sends mail outside the approved send path
* research never requests contact details from a model

---

## 4. The dataset: real data only

The Uganda 100 dataset was never supplied, and I would not invent Ugandan
businesses to stand in for it. You supplied something better:
**`docs/UMA-Dirrectory-2026.pdf`** — the Uganda Manufacturers Association
Business Directory, 272 pages of real, citable member data.

**Imported: 1,529 real Ugandan manufacturers**, 395 with websites, 1,550
contacts.

| | |
|---|---|
| Entries parsed | 1,547 |
| Publishing a website | 413 |
| With an email | ~1,418 |
| With a named contact | ~1,319 |

Handled properly:

* **Ligature repair.** The PDF encodes ligatures as unrelated code points.
  Each mapping was confirmed against several occurrences in context —
  `BuƩer`→Butter, `oĸce`→office, `smarƞoods`→smartfoods, `coīee`→coffee.
* **Unreadable values are quarantined, not guessed.** 140 entries had an email
  the encoding mangled beyond confident repair. These are recorded in the
  organisation's notes for a human to fix, and **not** stored as usable
  addresses — a half-repaired address is worse than a missing one, because
  someone might send to it.
* **Advertisement headlines rejected.** The directory interleaves adverts whose
  headlines are also in capitals ("REACH US TOLL-FREE AT", "BRANDS WE
  DISTRIBUTE"). These are filtered out.
* **Provenance on every record** — edition and page number, plus
  `directory.uma.or.ug` as the source URL.
* **Every contact imported `unverified`.** A printed directory records what was
  true at publication.

```bash
npx tsx scripts/import-uma.ts --parse-only      # inspect, write nothing
npx tsx scripts/import-uma.ts --dry-run
npx tsx scripts/import-uma.ts --website-only    # the auditable subset
npx tsx scripts/import-uma.ts                   # everything
```

**All 39 fictional seed organizations have been deleted.** The database now
contains real prospects only — 1,529 UMA members, 0 demo records, 0 `.test` or
`localhost` domains.

The seed no longer recreates them: fictional organizations are behind
`SEED_DEMO=true` and off by default, so `npm run db:seed` can never quietly
reintroduce invented companies into a database of real ones.

```bash
npm run demo:remove -- --dry-run   # inspect first
npm run demo:remove               # hard-delete every isDemoData record
```

The remover refuses to run if anything flagged demo has been approved for
client-facing use — that would mean the flag is untrustworthy and needs a human,
not a bulk delete. Note that `npx tsx scripts/audit-smoke.ts` recreates fixture
organizations (also flagged `isDemoData`); run `npm run demo:remove` after it.

---

## 5. Agent memory, autonomy and pitching

Built this session, in `src/server/agent/memory.ts` and
`src/components/agent-commands.ts`.

**Memory is the database, queried live.** Deliberately not a second summarised
store — a separate copy drifts, and a drifted memory is how an assistant starts
asserting things that stopped being true. The module is **read-only by
construction**, and a test enforces that.

It recalls:

* every client, with scores, findings, contacts, stage, last contact
* every email — sent, unsent draft, awaiting approval, replied, bounced
* the full activity timeline per client
* portfolio state: pipeline value, work in progress, approval queues, overdue tasks

**Autonomous prioritisation** — `agentPitchCandidates()` ranks who to approach,
and only marks one `readyToPitch` when it satisfies the *same conditions the
send gates enforce*: a verified, fresh, client-facing finding to reference, and
a verified contact who has not opted out and is not at the frequency cap. So the
assistant never recommends something that would be blocked at the final step.
Blocked prospects come back with the specific reason.

**Pitching** — `POST /api/agent/pitch` picks the best actionable prospect and
drafts the approach through the existing pipeline. **It stops at a draft.**
Approval and the eleven send gates are untouched, because an assistant that
could send is an assistant that could send something wrong to a real business.

What you can ask it:

| Ask | What happens |
|---|---|
| "Brief me" | Portfolio, work in progress, outreach state — all live numbers |
| "Who should I pitch?" | Ranked prospects with reasons and blockers |
| "Pitch the best one" | Drafts an approach for your review |
| "What have we sent?" / "Show unsent drafts" | Full outreach recall |
| "Tell me about \<client\>" | Everything on record for that client |
| "Find Uganda leads" | Checks candidate domains, audits those that respond |

Endpoints: `GET /api/agent/memory?scope=snapshot|clients|client|outreach|timeline|pitch|all`
and `POST /api/agent/pitch`. Both gated on the same permissions as the screens
showing the same data, so the assistant can never reveal more than the signed-in
user could see themselves.

---

## 5b. Finding businesses that need the service — with a qualification gate

Finds Ugandan businesses listed on Google that have **no website**, and refuses
to treat every listing it finds as a prospect.

```
  Google Places search
     -> full profile (reviews, rating, photos, hours, phone, website)
     -> QUALIFICATION GATE
     -> only qualified businesses become prospects
     -> findings recorded from the listing, still unverified
     -> a person reviews before any report, proposal or outreach
```

### The gate (`src/server/leads/qualification.ts`)

Two independent questions, both of which must pass. They fail for different
reasons, and conflating them is how a pipeline fills with junk:

**Is it established?** — reviews (40%), contactable (25%), rating (10%),
photos (10%), opening hours (10%), social presence (5%).

**Does it need what we sell?** — no website, or a Facebook / link-in-bio page
used *as* the website (70%); no description (15%); a thin profile (15%).

Both must reach 60 to qualify. Anything ambiguous returns
`needs_manual_review` rather than a guess. A missing signal scores as unknown,
never as a pass — a profile we cannot read scores low rather than scoring well
by omission.

### Hard rejections — not low scores, not prospects at all

* permanently or temporarily closed on Google
* fewer than 10 reviews — new, dormant, or a duplicate listing
* no telephone and no address — cannot be reached or confirmed
* rated below 3.0 — *"a business rated this low may have problems that a website
  will not solve"*
* the listing is a place, not a business (locality, route, transit stop)

A business that **already has a real website** does not qualify either, and the
reason says so: audit the site first, because that pitch is improvement, not a
first build.

Every verdict returns the signals behind it verbatim — `86 review(s)`,
`not published` — so the decision is explainable rather than just a number.

### Honest failure

Without `GOOGLE_PLACES_API_KEY` this returns *not configured* and stops. It does
**not** fall back to a language model, and the assistant says so when asked:

> I will not guess business names instead: a model asked to name companies
> produces plausible ones that do not exist.

### Findings from the listing

Five new catalogue rules, with the Google listing URL as evidence:
`gbp.no_website`, `gbp.social_as_website`, `gbp.no_description`,
`gbp.few_photos`, `gbp.no_hours`.

They go through the same classifier and the same defaults as the website
crawler — `auto_detected`, not client-visible. A different source of evidence is
not a different standard of evidence.

`POST /api/research/google-business` · ask the agent *"find restaurants in
Kampala with no website"* · 12 tests in `tests/qualification.test.ts`.

---

## 6. Running it

```bash
cd "App/marketing tool/brightscope"
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # -> SESSION_SECRET

npx prisma generate && npx prisma db push && npm run db:seed
npx tsx scripts/import-uma.ts        # the real dataset
npm run dev
```

Seeded accounts, password `BrightScope2026!Dev` — **change before any
deployment**: `admin@`, `auditor@`, `sales@`, `approver@`, `viewer@`
`brightthoughts.example`.

For the audit engine against controlled failure modes: `npm run fixtures`, then
add a prospect whose website is one of the printed fixture URLs.

---

## 7. Safety properties — do not weaken these

1. `unverifiable` never becomes a finding (`findings/classify.ts`). This is what
   makes "Unable to verify automatically" honest.
2. The finding catalogue is a closed set of ~60 rules with pre-approved,
   non-alarmist client wording. An unmapped issue is logged for review, never
   given wording it does not have.
3. AI cannot cite what it never saw — allow-listed projection of verified
   findings only, never contact personal data. Output is rejected for unknown
   finding ids, banned phrases (`vulnerable`, `hacked`, `losing millions`,
   guarantees), monetary amounts, or any number absent from the evidence.
   Rejected output is never shown as prose.
4. The app is fully functional with no AI key; the deterministic provider is the
   default, not a stub.
5. Eleven send gates, re-evaluated server-side at send time against the
   database — never trusted from the browser, never cached from approval.
6. Separation of duties: `approvedBy` may never equal `submittedBy`.
7. Commercial fields are human-only; a proposal cannot be submitted until a
   person confirms the terms, recorded with name and timestamp.
8. Outreach ships in safe mode (`EMAIL_PROVIDER=console`) — contacts nobody.
9. The crawler is polite: robots honoured with no bypass, one request per host
   at a time, capped redirects, GET/HEAD only, identifying User-Agent.
10. The activity log is append-only.

---

## 8. Still outstanding

1. **Brand details need confirming.** `src/config/brand.ts` now asserts a
   company name, phone, email, postal address and palette described as sourced
   from `brightilluminated.com`. I could not verify that provenance in this
   session. These appear on client-facing exports — confirm them with the
   business before anything is sent.
2. **Enter-to-send in the assistant was not confirmable under browser
   automation** (the synthetic keypress does not appear to reach React). An
   explicit `onKeyDown` handler is in place and typechecks; the send button is
   confirmed working. Worth a 10-second manual check.
3. **Remaining docs:** `API`, `ADMIN_GUIDE`, `USER_GUIDE`, `PHASE2`. Written:
   `README`, `ARCHITECTURE`, `PERMISSIONS`, `AUDIT_CHECKS`, `USER_JOURNEYS`,
   `ASSUMPTIONS`, `DEPLOYMENT`, `LIMITATIONS`, this file.
4. ~~Behavioural tests for the gates and approvals~~ — **done**. 19 integration
   tests in `tests/integration/send-gates.test.ts` exercise every gate against
   real rows, on an isolated database.
5. **Price book is empty.** No price was invented; an administrator enters it
   before the first proposal.
6. Legal review of Ugandan data-protection and electronic-communications
   obligations, and SPF/DKIM/DMARC, before `EMAIL_PROVIDER` leaves `console`.
