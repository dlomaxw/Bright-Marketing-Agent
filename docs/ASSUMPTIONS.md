# Assumptions, Missing Inputs and Required Credentials

## 1. Missing input: the Uganda 100 Website Lead Audit dataset

The brief names this dataset as the starting data. It was **not present** in either working
directory — only `Marketing_Audit_Outreach_Tool_Product_Documentation.docx` was supplied.

**Decision:** no real Ugandan organizations, domains, contacts or findings were invented to fill
the gap. Fabricating prospect records and website problems would breach the product's central rule
on its first day, and a fabricated domain could collide with a real business.

**What ships instead:**

* `prisma/seed/demo-organizations.json` — 24 clearly fictional organizations using reserved
  domains (`.test`, `.invalid`, `.example`) that can never resolve to a real site. Every row has
  `isDemoData: true`.
* Imported legacy findings on those rows are created with `verificationStatus: 'needs_review'`,
  `requiresReverification: true`, `clientVisible: false`, and are excluded from reports and
  outreach until re-audited — matching the freshness policy in the documentation (21).
* A local fixture site (`fixtures/`) reproduces the real failure modes — directory index, holding
  page, WordPress sample page, lorem ipsum, missing metadata, redirect loop, offline host — so the
  audit engine is exercised against genuine responses rather than mocked ones.

**To load the real dataset:** put the CSV/XLSX at any path and run
`npm run import -- <path>`, or use **Leads → Import** in the UI. The column mapper already targets
the reference field map from documentation section 21:

| Reference column | Target |
|---|---|
| Score | `Organization.importedScore` (advisory only; recalculated on first audit) |
| Organization | `Organization.legalName` / `brandName` |
| Industry | `Organization.industry` |
| Website | `Organization.website` |
| Status / Issue | `Finding` with `source: 'imported'`, `requiresReverification: true` |
| Contact | `Contact` with `verificationStatus: 'unverified'` |
| Sales offer | `Organization.suggestedServiceCodes` (editable) |
| Public source URL | `Evidence.sourceUrl` with a fresh timestamp recorded on re-check |

## 2. Assumptions taken

1. **Brand.** Colours are as specified. Logo, exact legal entity name, physical address, sender
   signatures, VAT/tax registration and proposal legal wording are **placeholders** in
   `src/config/brand.ts` and Settings, marked `TODO: confirm with Bright Thoughts`.
2. **Pricing.** The service catalogue ships with names, deliverables and phases from Appendix A,
   and **zero prices**. No price was invented. An administrator enters the price book before the
   first proposal.
3. **Currency and locale.** UGX default, USD secondary; `Africa/Kampala` display timezone; all
   timestamps stored UTC.
4. **Approval model.** Content approval and send approval are separate, per documentation 2.1.
   Sensitive sectors (government, health, education, finance, regulated) require a senior approver.
5. **Sending.** No email provider is configured and no real address is contacted. The default
   `console` provider writes the message to the outbox and the activity log. A real provider must
   be explicitly enabled by an administrator.
6. **Social and Google data.** No platform tokens supplied, so every social and GBP check runs in
   manual-review mode. No scraping fallback is implemented — by design.
7. **Performance data.** No PageSpeed Insights key, so Core Web Vitals report as
   `unverifiable`. Page weight and image sizes *are* measured deterministically from the responses
   we already fetch, so those findings are real.
8. **Scale.** MVP sizing: single Next.js instance, single worker, low thousands of organizations.
   The database queue is adequate; see docs/PHASE2.md for the Redis path.

## 3. Credentials required before production

| Variable | Needed for | Status |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | **Required** |
| `SESSION_SECRET` | Cookie signing (32+ bytes) | **Required** |
| `ANTHROPIC_API_KEY` | AI drafting | Optional — deterministic templates used without it |
| `PAGESPEED_API_KEY` | Core Web Vitals | Optional — CWV is `unverifiable` without it |
| `GOOGLE_PLACES_API_KEY` | Google Business review | Optional — manual mode without it |
| `EMAIL_PROVIDER` + provider keys | Approved sending | Optional — outbox/manual mode without it |
| `META_ACCESS_TOKEN` | Facebook/Instagram | Optional — manual mode |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn | Optional — manual mode |
| `YOUTUBE_API_KEY` | YouTube | Optional — manual mode |
| `S3_*` / storage | Evidence artifacts at scale | Optional — local filesystem in dev |

Every optional integration degrades to an explicit manual-review state. Nothing degrades to a
guess.

## 4. Decisions requiring a human before launch

1. Confirm the product name **BrightScope** against domain and trademark availability
   (documentation flags this).
2. Legal review of Ugandan data-protection and electronic-communications obligations for B2B
   outreach, plus a data-protection impact assessment.
3. Sign-off on the finding severity table and the client-facing wording of each recommendation.
4. Sign-off on the price book and on who holds `pricing.write`.
5. Confirm sender domains, SPF/DKIM/DMARC, and deliverability testing before any real send.
