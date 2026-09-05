import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { domainKey, nameKey, normalizeUrl } from '@/lib/normalize';
import { WEB_CHECK_GROUPS } from '@/lib/enums';
import { createAuditRun, drainQueue } from '@/server/audit/runner';
import { fetchPage } from '@/audit/fetcher';
import { logActivity } from '@/server/activity';

/**
 * Uganda prospect discovery.
 *
 * WHAT THIS CAN AND CANNOT DO — read before changing.
 *
 * A language model without a grounded search tool cannot perform web research.
 * Asked for "businesses in Uganda" it will produce plausible-sounding company
 * names, domains and telephone numbers that may not exist — and a fabricated
 * Ugandan phone number may well belong to a real person.
 *
 * An earlier version of this module took that output and wrote it straight into
 * the prospect table with `isDemoData: false`, then marked every resulting
 * finding `manually_verified` and `clientVisible`. That manufactured prospects
 * and manufactured client-facing claims about them.
 *
 * So this module now treats model output as nothing more than a list of
 * CANDIDATE DOMAINS TO CHECK, and everything after that is deterministic:
 *
 *   1. The model (or a configured seed list) proposes candidate domains.
 *   2. Every candidate is verified by actually fetching it. A domain that does
 *      not resolve or does not serve a page is discarded — it is not evidence
 *      of a business.
 *   3. Surviving candidates become organizations at stage `researching`, marked
 *      as unconfirmed, with NO model-supplied contact details stored.
 *   4. The real audit engine runs against the real site.
 *   5. Findings stay unverified. A person reviews them, exactly as everywhere
 *      else in the product.
 *
 * The name recorded is the one the site itself publishes where we can read it,
 * falling back to the domain — never the model's guess alone.
 */

export interface ResearchUgandaOptions {
  query?: string;
  industry?: string;
  maxLeads?: number;
  actorId: string;
  /** Explicit domains to check, bypassing the model entirely. Preferred. */
  candidateDomains?: string[];
}

export interface CandidateDomain {
  domain: string;
  /** Only ever a hint for the analyst. Never stored as fact. */
  suggestedName?: string;
  suggestedIndustry?: string;
}

export interface ResearchResultItem {
  organizationId: string;
  name: string;
  website: string;
  auditRunId: string;
  findingsDetected: number;
  awaitingVerification: number;
  /** Deliverables are only produced from human-verified findings. */
  reportId: string | null;
  proposalId: string | null;
  note: string;
}

export interface ResearchOutcome {
  query: string;
  industry: string;
  candidatesProposed: number;
  candidatesReachable: number;
  candidatesDiscarded: { domain: string; reason: string }[];
  results: ResearchResultItem[];
  /** True when a model proposed the candidates rather than a person. */
  candidatesAreUnconfirmed: boolean;
  nextStep: string;
}

/**
 * Asks the model for candidate DOMAINS only. Names and industries come back as
 * hints for the analyst; contact details are deliberately not requested,
 * because we would have no way to verify them and no right to invent them.
 */
async function proposeCandidates(
  query: string,
  industry: string,
  maxLeads: number,
): Promise<CandidateDomain[]> {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY;
  if (!apiKey) return [];

  const prompt = `List up to ${maxLeads} website domains of businesses that operate in Uganda and match: "${query}" (industry: ${industry}).

Rules:
- Return ONLY domains you have genuine reason to believe exist. If you are unsure, return fewer.
- Do NOT invent a domain to fill the list. An empty list is a valid and preferred answer.
- Do NOT return telephone numbers, email addresses or postal addresses.
- Any top-level domain is acceptable (.com, .co.ug, .ug, .org, .net).

Respond strictly as JSON:
{"candidates":[{"domain":"example.co.ug","suggestedName":"Company name if known","suggestedIndustry":"${industry}"}]}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return [];

    const payload = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(text) as { candidates?: CandidateDomain[] };
    return Array.isArray(parsed.candidates) ? parsed.candidates : [];
  } catch {
    // Discovery is a convenience. Failing it must never fail the caller.
    return [];
  }
}

/** Reads the organisation name the site publishes about itself. */
function nameFromPage(html: string | null, fallback: string): string {
  if (!html) return fallback;
  const title = html.match(/<title[^>]*>([^<]{2,120})<\/title>/i)?.[1]?.trim();
  if (!title) return fallback;
  // Trim the common "Name | tagline" and "Name - tagline" patterns.
  const head = title.split(/\s[|–—-]\s/)[0]?.trim();
  return head && head.length >= 3 ? head : title;
}

export async function researchUgandaLeads(opts: ResearchUgandaOptions): Promise<ResearchOutcome> {
  const maxLeads = Math.min(opts.maxLeads ?? 3, 10);
  const industry = opts.industry || 'Business Services';
  const query = opts.query || `${industry} companies in Uganda`;

  const humanSupplied = (opts.candidateDomains ?? []).filter(Boolean);
  const candidates: CandidateDomain[] = humanSupplied.length
    ? humanSupplied.map((domain) => ({ domain }))
    : await proposeCandidates(query, industry, maxLeads);

  const candidatesAreUnconfirmed = humanSupplied.length === 0;
  const discarded: { domain: string; reason: string }[] = [];
  const results: ResearchResultItem[] = [];

  for (const candidate of candidates.slice(0, maxLeads)) {
    const website = normalizeUrl(candidate.domain);
    if (!website) {
      discarded.push({ domain: candidate.domain, reason: 'Not a usable web address.' });
      continue;
    }

    // A candidate only becomes a prospect if the site actually answers.
    // This is the step that separates a real business from a generated name.
    const probe = await fetchPage(website);
    if (probe.error) {
      discarded.push({
        domain: candidate.domain,
        reason: `Did not respond (${probe.error.kind}: ${probe.error.message}). Not recorded as a prospect.`,
      });
      continue;
    }
    if (probe.status >= 400) {
      discarded.push({
        domain: candidate.domain,
        reason: `Returned HTTP ${probe.status}. Not recorded as a prospect.`,
      });
      continue;
    }

    const dKey = domainKey(website);
    const publishedName = nameFromPage(probe.html, dKey ?? candidate.domain);
    const nKey = nameKey(publishedName);

    let org = await db.organization.findFirst({
      where: { OR: [{ domainKey: dKey }, { nameKey: nKey }], deletedAt: null },
    });

    if (!org) {
      org = await db.organization.create({
        data: {
          // The name the site publishes about itself, not the model's guess.
          legalName: publishedName,
          nameKey: nKey,
          website,
          domainKey: dKey,
          industry: candidate.suggestedIndustry || industry,
          city: null,
          country: 'Uganda',
          sector: 'standard',
          stage: 'researching',
          source: 'research',
          sourceUrl: website,
          isDemoData: false,
          ownerId: opts.actorId,
          // Contact details are NOT taken from the model. They are gathered by
          // an analyst from the site itself, with a recorded source URL.
          notes: candidatesAreUnconfirmed
            ? `Discovered by automated domain research on ${new Date().toISOString().slice(0, 10)}. ` +
              `The site responded with HTTP ${probe.status}, which is why it was recorded. ` +
              `The organisation name was read from the page title and the industry is an unconfirmed suggestion — ` +
              `confirm both, and add contacts with their source URL, before any outreach.`
            : `Added from an analyst-supplied domain list on ${new Date().toISOString().slice(0, 10)}.`,
        },
      });

      await logActivity({
        organizationId: org.id,
        actorId: opts.actorId,
        action: 'lead.discovered',
        entityType: 'organization',
        entityId: org.id,
        newValue: { website, httpStatus: probe.status, publishedName },
        reason: candidatesAreUnconfirmed
          ? 'Automated domain research. Name and industry require confirmation.'
          : 'Analyst-supplied domain.',
      });
    }

    // The audit itself is fully deterministic and is the real evidence.
    const run = await createAuditRun({
      organizationId: org.id,
      groups: [...WEB_CHECK_GROUPS],
      requestedById: opts.actorId,
    });
    await drainQueue(30);

    const [detected, awaiting, verifiedVisible] = await Promise.all([
      db.finding.count({ where: { organizationId: org.id, deletedAt: null } }),
      db.finding.count({
        where: {
          organizationId: org.id,
          deletedAt: null,
          verificationStatus: { in: ['auto_detected', 'needs_review'] },
        },
      }),
      db.finding.count({
        where: {
          organizationId: org.id,
          deletedAt: null,
          verificationStatus: 'manually_verified',
          clientVisible: true,
        },
      }),
    ]);

    // Deliverables are NOT generated here. They require verified findings, and
    // verification is a human act. Producing a client deck from unreviewed
    // machine output is precisely what this product exists to prevent.
    results.push({
      organizationId: org.id,
      name: org.legalName,
      website,
      auditRunId: run.id,
      findingsDetected: detected,
      awaitingVerification: awaiting,
      reportId: null,
      proposalId: null,
      note:
        verifiedVisible > 0
          ? `${verifiedVisible} verified finding(s) are already client-facing. A report can be generated from the lead workspace.`
          : `${awaiting} finding(s) need review before any report, proposal or outreach can be produced.`,
    });
  }

  return {
    query,
    industry,
    candidatesProposed: candidates.length,
    candidatesReachable: results.length,
    candidatesDiscarded: discarded,
    results,
    candidatesAreUnconfirmed,
    nextStep:
      results.length === 0
        ? 'No candidate domain responded, so no prospect was created. Supply domains directly for a reliable result.'
        : 'Review the findings for each discovered prospect, verify the ones that hold, then generate the report and proposal.',
  };
}
