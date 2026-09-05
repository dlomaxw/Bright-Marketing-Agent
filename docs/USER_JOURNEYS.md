# User Journeys

## J1 — Auditor: lead to verified findings (target: under 15 minutes)

1. **Leads → New prospect.** Enter organization, domain, industry, country, city, tags.
   On blur the domain is normalized (`https://`, lowercase, strip `www.`, strip path) and checked
   against existing records. A duplicate on normalized domain, normalized name, email or E.164
   phone shows an inline banner with a link to the existing record and a *Merge* action.
2. **Lead workspace → Contacts.** Add a contact with `source URL` (required) and verification
   status. `Unverified` contacts are visible everywhere they are used, in amber.
3. **Lead workspace → Platforms.** Paste Facebook/Instagram/LinkedIn/X/TikTok/YouTube/GBP URLs.
4. **Run audit.** Select check groups (all on by default). The run appears as `queued`, then
   `running` with a per-group progress list. Failed groups show the failure reason and a retry.
5. **Findings & Evidence.** Split view: evidence panel (URL, status, timestamp, captured snippet,
   redirect chain, raw response headers) beside the editable finding (severity, confidence,
   observation text, impact, recommendation, visibility).
   Actions: **Accept** · **Edit** · **Dismiss** (reason required) · **Needs review** · **Re-check**.
   `Unable to verify automatically` rows are listed separately and never become findings.
6. **Score.** The opportunity score appears with its five components, each showing the inputs that
   produced it and the current admin weights. Nothing is a black box.

Exit state: organization at stage `Audit completed`, findings verified, score explainable.

## J2 — Auditor: verified findings to an approved report

1. **Report → Generate.** Sections are pre-filled from client-visible, fresh, verified findings.
   Stale or low-confidence findings are listed as *excluded* with the reason shown.
2. Edit any section. Include/exclude individual findings. Add screenshots and comments.
3. **Submit for approval** → status `pending_approval`, version frozen, approver notified.
4. Approver opens the report, sees every claim linked to its evidence, and approves or rejects
   with a comment. Rejection returns it to `changes_requested`; editing creates version *n+1*.
5. Export DOCX or PDF. Exports carry the version number and approval status in the footer.

## J3 — Sales: approved report to an approved proposal

1. **Proposal → Generate from report.** Service modules are suggested from the finding categories
   using the mapping in the product documentation (10.0). Every suggestion shows *which findings*
   triggered it.
2. Add/remove modules, set quantities, phases and deliverables.
3. **Commercials.** Currency (UGX/USD), unit fees, discount, tax rate, payment schedule, validity,
   assumptions, exclusions, change-control text. These fields are human-only; an AI draft leaves
   them blank and shows *Requires human pricing*.
4. Submit → approve. Same versioning and separation-of-duties rules as the report.

## J4 — Sales: personalized email through approval to send

1. **Email → Draft.** Pick recipient (verified contacts first; unverified are selectable but
   raise a gate). Pick at most two verified findings to reference. Choose template and sender.
2. The draft shows a **live approval checklist** with nine gates:
   recipient verified · organization matches · evidence fresh · subject present and non-alarmist ·
   body free of banned phrases · sender approved · attachments are approved versions ·
   contact not suppressed · frequency cap not exceeded.
   Each failing gate links to the fix.
3. **Submit for approval** → approver reviews recipient, content, attachments and gates.
4. **Send** is disabled until the email is `approved` *and* every gate passes at the moment of
   sending (gates are re-evaluated server-side, not trusted from the client).
5. Sending is idempotent: a per-draft send key prevents a double send; the provider message id is
   stored. With no provider configured, *Mark as sent manually* records the outreach with actor
   and timestamp instead.

## J5 — Sales: outreach to outcome

Reply logged → stage `Replied` → meeting scheduled with notes → proposal presented →
negotiation → `Won` (reason, value) or `Lost` (reason) or `Nurture`. Every transition writes an
`Activity` row. Tasks with due dates and owners drive the follow-up list and the overdue counter
on the dashboard.

## J6 — Administrator

Users and roles · scoring weights (with a live preview of how the change re-ranks the current
lead list) · service catalogue and price book · templates for report sections, proposal clauses
and email bodies · integrations and credentials · retention windows · suppression list ·
activity log with filters and CSV export.

## J7 — Approver

A single queue at `/approvals` combining reports, proposals and emails, each showing what changed
since the last version, who submitted it, the evidence age, and any failing gate. Approve or
reject with a mandatory comment on rejection.

## Failure paths the UI must handle explicitly

| Situation | Presentation |
|---|---|
| Invalid URL at entry | Inline validation, record not created |
| Site offline / DNS failure | Audit completes with `unverifiable` observations and a clear banner; no findings invented |
| Redirect loop | Chain shown, capped, recorded as an issue |
| robots.txt disallows | "Blocked by robots.txt — manual review required", no bypass offered |
| Social profile missing | Checklist item `not found`, recorded with timestamp, no assumption of absence |
| Content changed since audit | Freshness badge turns amber then red; re-check offered inline |
| Duplicate lead / contact | Merge flow, never a silent second record |
| AI referenced an unknown finding | Draft rejected, `NEEDS_REVIEW` shown with the offending ids |
| Opted-out recipient | Recipient not selectable; hard block at send with the opt-out date |
| Missing approval | Send button disabled with the specific missing approval named |
