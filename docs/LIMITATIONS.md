# Known limitations

Written plainly, because a limitation you know about is manageable and one you
discover in front of a client is not. Several of these are deliberate design
decisions rather than defects; those are marked **by design**.

---

## 1. What the audit can and cannot tell you

### It is not a security assessment — **by design**

The engine records publicly observable characteristics of a website. It makes
`GET` and `HEAD` requests only, never attempts authentication, never submits a
form, and never tries to trigger a fault.

It therefore **cannot** tell you whether a site is secure, and the product will
not say that it can. The finding catalogue contains no vulnerability wording,
and the AI validator rejects the words *vulnerable*, *hacked*, *breached*,
*exploit* and *malware* outright. If a client needs a security assessment, that
is a different engagement with different consent.

### Accessibility findings are markup signals, not conformance

Alt text, form labels, link text, heading order and declared language are read
from the markup. Contrast measurement, keyboard testing and assistive-technology
review are not performed. Reports say so explicitly. Do not describe this output
as a WCAG audit.

### Performance is partial

Document weight and image sizes are genuinely measured from the responses
already fetched, so those findings are real. **Core Web Vitals are not
estimated.** Without an authorised PageSpeed Insights key they report as
`unverifiable`, which is the honest answer.

### Certificate expiry is not read

The connection succeeding proves the certificate was accepted at request time.
The runtime HTTP client does not expose the peer certificate, so expiry dates
are reported as requiring manual confirmation rather than guessed.

### The crawl is shallow

Roughly a dozen pages per run, one host at a time, with a minimum interval
between requests. A finding of "no contact form" means none was found on the
pages sampled — not a proof of absence across the whole site. Severity and
confidence are set accordingly, and an analyst can always look further.

### A blocked site produces nothing — **by design**

If `robots.txt` disallows us, or the site times out, the result is *"Unable to
verify automatically"* and **no finding**. There is no bypass path in the code.
This is the mechanism that makes the phrase honest rather than decorative.

---

## 2. Social media and Google Business

Facebook, Instagram, LinkedIn, X, TikTok and YouTube are all API-gated. With no
authorised token configured, these groups produce a **structured manual-review
checklist**, not data. There is no scraping fallback — **by design**; the
product documentation forbids bypassing platform controls, and an unverified
guess is worse than an honest gap.

Engagement metrics are recorded only from an authorised API. They are never
scraped and never estimated.

Google Business discovery requires `GOOGLE_PLACES_API_KEY`. Without it, discovery
reports *not configured* and stops rather than asking a language model to name
businesses.

---

## 3. Data quality

### The UMA directory is a printed snapshot

1,529 real Ugandan manufacturers, imported with edition and page provenance. But
a directory records what was true at publication:

- **Every imported contact is `unverified`.** Confirm before contacting.
- **140 entries had an email the PDF's font encoding mangled beyond confident
  repair.** These are recorded in the organisation's notes for a human to fix and
  are **not** stored as usable addresses — a half-repaired address is worse than
  a missing one, because someone might send to it.
- Company names are read from the directory's own capitalised headings.
  Advertisement headlines are filtered out, but the filter is heuristic; a
  handful of odd names may survive.

### Deduplication is good, not perfect

Duplicates are detected on normalized domain, normalized name, email and E.164
phone. Two records for the same business under genuinely different trading names
with no shared contact detail will not be caught automatically.

### Phone normalisation assumes Uganda

National-format numbers are assumed to be `+256` unless they carry a country
code. A number from elsewhere entered in national format will normalise wrongly.

---

## 4. Scale and operations

- **Sized for the MVP**: a single application instance, a single worker, low
  thousands of organizations. The audit queue is a database table, which is
  adequate at that size. See PHASE2.md for the Redis path.
- **The login throttle is in-process.** Behind more than one instance it is
  per-instance rather than global. It moves to the shared store with the queue.
- **SQLite in development.** Fine for one developer; production must be
  PostgreSQL (`npm run db:use postgres`).
- **The dev server and a production build share `.next`.** Running `next build`
  while `next dev` is up breaks the running server. Use `npm run build:check`,
  which builds into a separate directory.

---

## 5. AI

- **Optional.** With no API key the deterministic provider produces a complete,
  evidence-linked draft. AI improves the prose; it is never required.
- **Constrained.** The model receives an allow-listed projection of verified
  findings only, and never contact personal data. Output is rejected for unknown
  finding ids, banned phrases, monetary amounts, or any number not present in the
  supplied evidence. Rejected output is never shown as prose — the deterministic
  draft is used and the rejection reasons are surfaced.
- **The number check is conservative.** Small integers and percentages that could
  plausibly be structural (dates, counts under 100) are allowed through. A
  fabricated statistic phrased with a common number could pass validation. Human
  review of client-facing documents remains necessary — which is why it is
  mandatory.
- **AI cannot write commercial terms.** Prices, discounts, tax and payment terms
  are stripped from model output and can only be set by a person holding
  `proposal.set_commercials`.

---

## 6. Not built

Present in the product documentation but out of scope for this build:

- Competitor comparison
- Before/after monitoring and client performance dashboards
- Proposal e-signature, invoicing and payment
- A client-facing portal
- Multilingual outreach templates
- Recurring change detection on monitored domains
- Lead enrichment through a third-party provider

The SMTP sending path is **stubbed and throws deliberately**. Enabling real
delivery is a decision with legal and deliverability prerequisites, not a
configuration flag — see DEPLOYMENT.md §1.

---

## 7. Verification status

Verified by running it: typecheck clean; 70 tests across 8 files; production
build compiles; the audit engine passes 12 fixture failure modes; a real audit
against a live UMA member site produced 16 genuine findings with the
verification gate holding.

**Not yet done:** a full click-through of every screen by a person, and a pilot
with the 20-lead sample the product documentation recommends before production
launch.
