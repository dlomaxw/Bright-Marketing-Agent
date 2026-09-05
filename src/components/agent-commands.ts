/**
 * The assistant's command interpretation.
 *
 * Kept out of the component so it can be reasoned about (and tested) on its
 * own. Two rules shape it:
 *
 *  1. Recall answers come from the database via /api/agent/memory. The
 *     assistant never states a number it did not just read.
 *  2. The pitch action stops at a draft. Approval and the send gates are
 *     untouched, so the assistant cannot cause a message to reach anyone.
 */

export interface AgentReply {
  /** What to say and show. */
  text: string;
  /** Optional route to navigate to afterwards. */
  navigateTo?: string;
  /** Longer structured detail rendered under the reply. */
  details?: string[];
}

const money = (n: number) => `UGX ${Math.round(n).toLocaleString('en-UG')}`;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface Snapshot {
  portfolio: { totalClients: number; openPipeline: number; pipelineValue: number; won: number; lost: number };
  work: {
    auditsRunning: number;
    findingsAwaitingVerification: number;
    reportsAwaitingApproval: number;
    proposalsAwaitingApproval: number;
    emailsAwaitingApproval: number;
    overdueTasks: number;
  };
  outreach: { sent: number; unsentDrafts: number; awaitingApproval: number; replied: number; suppressedContacts: number };
  recentActivity: { action: string; organization: string | null; actor: string | null; occurredAt: string }[];
}

interface PitchCandidate {
  organizationId: string;
  name: string;
  opportunityScore: number;
  confidenceScore: number | null;
  rationale: string[];
  blockers: string[];
  readyToPitch: boolean;
  usableFindings: { reference: string; observation: string }[];
  contact: { name: string; role: string | null } | null;
}

interface ClientSummary {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  stageLabel: string;
  opportunityScore: number | null;
  confidenceScore: number | null;
  findingsTotal: number;
  findingsVerified: number;
  findingsClientFacing: number;
  contactsTotal: number;
  contactsVerified: number;
  hasOptOut: boolean;
  lastContactedAt: string | null;
  isDemoData: boolean;
}

interface OutreachRecord {
  organizationName: string;
  subject: string;
  status: string;
  recipient: string | null;
  sentAt: string | null;
}

const NAV: { match: RegExp; route: string; label: string }[] = [
  { match: /\b(dashboard|home)\b/, route: '/', label: 'the dashboard' },
  { match: /\b(pipeline)\b/, route: '/pipeline', label: 'the pipeline board' },
  { match: /\b(approval|queue)\b/, route: '/approvals', label: 'the approvals queue' },
  { match: /\b(finding|evidence|verify)\b/, route: '/findings', label: 'findings review' },
  { match: /\b(report)\b/, route: '/reports', label: 'reports' },
  { match: /\b(proposal|commercial)\b/, route: '/proposals', label: 'proposals' },
  { match: /\b(task|follow.?up|todo)\b/, route: '/tasks', label: 'tasks' },
  { match: /\b(setting|config)\b/, route: '/settings', label: 'settings' },
  { match: /\b(log|activity)\b/, route: '/logs', label: 'the activity log' },
  { match: /\b(analytic)\b/, route: '/analytics', label: 'analytics' },
];

export async function interpretCommand(raw: string): Promise<AgentReply> {
  const cmd = raw.toLowerCase().trim();
  if (!cmd) return { text: 'Say or type a command.' };

  // --- Recall: overall state ------------------------------------------------
  if (/\b(status|summary|overview|how are we|what.s going on|brief me|catch me up)\b/.test(cmd)) {
    const data = await getJson<{ snapshot: Snapshot }>('/api/agent/memory?scope=snapshot');
    if (!data) return { text: 'I could not read the current state just now.' };
    const { portfolio, work, outreach } = data.snapshot;

    return {
      text:
        `${portfolio.totalClients} clients on record, ${portfolio.openPipeline} open, ` +
        `worth ${money(portfolio.pipelineValue)}. ${portfolio.won} won, ${portfolio.lost} lost.`,
      details: [
        `${work.findingsAwaitingVerification} finding(s) awaiting verification`,
        `${work.reportsAwaitingApproval + work.proposalsAwaitingApproval + work.emailsAwaitingApproval} item(s) awaiting approval`,
        `${outreach.sent} email(s) sent, ${outreach.unsentDrafts} unsent draft(s), ${outreach.replied} repl(y/ies)`,
        `${work.overdueTasks} overdue task(s)`,
        `${outreach.suppressedContacts} contact(s) opted out and cannot be contacted`,
      ],
    };
  }

  // --- Recall: outreach history --------------------------------------------
  if (/\b(sent|unsent|draft|outreach history|what did (i|we) send|emails? sent)\b/.test(cmd)) {
    const wantUnsent = /\bunsent|draft|not sent|pending\b/.test(cmd);
    const scope = wantUnsent ? 'unsent' : 'sent';
    const data = await getJson<{ outreach: OutreachRecord[] }>(
      `/api/agent/memory?scope=outreach&outreachStatus=${scope}&limit=15`,
    );
    if (!data) return { text: 'I could not read the outreach history.', navigateTo: '/emails' };
    if (data.outreach.length === 0) {
      return {
        text: wantUnsent ? 'There are no unsent drafts.' : 'Nothing has been sent yet.',
        navigateTo: '/emails',
      };
    }
    return {
      text: `${data.outreach.length} ${wantUnsent ? 'unsent draft(s)' : 'sent message(s)'}:`,
      details: data.outreach.map(
        (o) =>
          `${o.organizationName} — "${o.subject}" [${o.status}]` +
          (o.sentAt ? ` · sent ${o.sentAt.slice(0, 10)}` : '') +
          (o.recipient ? ` · ${o.recipient}` : ''),
      ),
      navigateTo: '/emails',
    };
  }

  // --- Act: draft a pitch ---------------------------------------------------
  if (/\b(pitch|draft an? (email|approach)|reach out|contact)\b/.test(cmd)) {
    const res = await fetch('/api/agent/pitch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as {
      drafted?: boolean;
      name?: string;
      href?: string;
      rationale?: string[];
      blockers?: string[];
      blocked?: { name: string; blockers: string[] }[];
      reason?: string;
      nextStep?: string;
      error?: string;
    };

    if (!res.ok) return { text: data.error ?? 'I could not draft an approach.' };

    if (data.drafted) {
      return {
        text: `Drafted an approach to ${data.name}. It needs your review and a second person's approval before it can be sent.`,
        details: [...(data.rationale ?? []), data.nextStep ?? ''].filter(Boolean),
        navigateTo: data.href,
      };
    }
    return {
      text: data.reason ?? 'Nothing is ready to pitch.',
      details:
        data.blocked?.map((b) => `${b.name}: ${b.blockers.join('; ')}`) ??
        data.blockers ??
        [],
      navigateTo: '/leads',
    };
  }

  // --- Recall: who to approach ---------------------------------------------
  if (/\b(who|which|best|priorit|score|opportunit|target|next)\b/.test(cmd)) {
    const data = await getJson<{ candidates: PitchCandidate[] }>('/api/agent/memory?scope=pitch&limit=6');
    if (!data || data.candidates.length === 0) {
      return { text: 'No scored prospects yet. Run an audit and verify some findings first.', navigateTo: '/leads' };
    }
    const ready = data.candidates.filter((c) => c.readyToPitch);
    const top = data.candidates[0]!;

    return {
      text: ready.length
        ? `${ready.length} prospect(s) are ready to approach. Best right now: ${ready[0]!.name}, score ${ready[0]!.opportunityScore}.`
        : `Nothing is ready to approach yet. Highest scoring is ${top.name} at ${top.opportunityScore}, but it is blocked.`,
      details: data.candidates.map((c) =>
        c.readyToPitch
          ? `READY · ${c.name} (${c.opportunityScore}) — ${c.rationale.join(' ')}`
          : `BLOCKED · ${c.name} (${c.opportunityScore}) — ${c.blockers.join('; ')}`,
      ),
      navigateTo: '/leads',
    };
  }

  // --- Recall: a specific client -------------------------------------------
  const aboutMatch = cmd.match(/\b(?:about|tell me about|status of|how is|info on)\s+(.{2,60})$/);
  if (aboutMatch) {
    const needle = aboutMatch[1]!.replace(/[?.!]$/, '').trim();
    const data = await getJson<{ clients: ClientSummary[] }>('/api/agent/memory?scope=clients&limit=200');
    const hit = data?.clients.find((c) => c.name.toLowerCase().includes(needle));
    if (hit) {
      return {
        text: `${hit.name} — ${hit.stageLabel}. Opportunity ${hit.opportunityScore ?? 'not scored'}, evidence confidence ${hit.confidenceScore ?? 'n/a'}.`,
        details: [
          hit.website ?? 'No website on record',
          `${hit.findingsTotal} finding(s): ${hit.findingsVerified} verified, ${hit.findingsClientFacing} client-facing`,
          `${hit.contactsTotal} contact(s), ${hit.contactsVerified} verified${hit.hasOptOut ? ' — one has opted out' : ''}`,
          hit.lastContactedAt ? `Last contacted ${hit.lastContactedAt.slice(0, 10)}` : 'Never contacted',
          hit.isDemoData ? 'This is a seeded demonstration record — do not contact it.' : '',
        ].filter(Boolean),
        navigateTo: `/leads/${hit.id}`,
      };
    }
    return { text: `I have no client matching "${needle}".`, navigateTo: `/leads?q=${encodeURIComponent(needle)}` };
  }

  // --- Discovery: businesses on Google with no website ----------------------
  if (
    /\b(no website|without (a )?websites?|not have a website|google (business|maps|listing)|unlisted)\b/.test(
      cmd,
    )
  ) {
    // Pull the trade/place out of the request so "find restaurants in Jinja
    // with no website" searches for restaurants in Jinja.
    const subject =
      cmd
        .replace(
          /\b(find|search|look for|get|show me|businesses|business|companies|company|that|who|which|with|without|have|has|no|a|websites?|on google|google (business|maps|listing)|in uganda|for me|please)\b/g,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim() || 'businesses';

    const query = /uganda|kampala|entebbe|jinja|gulu|mbarara|mbale|masaka|arua|lira/i.test(raw)
      ? `${subject} Uganda`
      : `${subject} in Kampala Uganda`;

    const res = await fetch('/api/research/google-business', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, maxResults: 20 }),
    });
    const data = (await res.json()) as {
      configured?: boolean;
      message?: string;
      searched?: number;
      qualified?: number;
      created?: number;
      businesses?: {
        name: string;
        verdict: string;
        establishedScore: number;
        needScore: number;
        reviews: number | null;
        rating: number | null;
        reasons: string[];
        blockers: string[];
        opportunity: string | null;
        organizationId: string | null;
      }[];
      error?: string;
    };

    if (!res.ok) return { text: data.error ?? 'The search could not be completed.' };

    if (data.configured === false) {
      return {
        text: 'I cannot search Google Business yet — no API key is configured.',
        details: [
          data.message ?? '',
          'Set GOOGLE_PLACES_API_KEY in .env and restart, then ask me again.',
          'I will not guess business names instead: a model asked to name companies produces plausible ones that do not exist.',
        ].filter(Boolean),
      };
    }

    const all = data.businesses ?? [];
    const qualified = all.filter((b) => b.verdict === 'qualified');
    const rejected = all.filter((b) => b.verdict === 'rejected');
    const review = all.filter((b) => b.verdict === 'needs_manual_review');

    return {
      text:
        qualified.length > 0
          ? `Searched "${query}". ${qualified.length} of ${data.searched ?? 0} listing(s) passed qualification and were added as prospects.`
          : `Searched "${query}". None of the ${data.searched ?? 0} listing(s) passed qualification, so nothing was added.`,
      details: [
        ...qualified.map(
          (b) =>
            `QUALIFIED · ${b.name} — ${b.reviews ?? 0} reviews${b.rating ? `, ${b.rating}★` : ''} · established ${b.establishedScore}/need ${b.needScore} · ${b.opportunity ?? ''}`,
        ),
        ...review.map(
          (b) => `REVIEW · ${b.name} — established ${b.establishedScore}/need ${b.needScore}. ${b.reasons[0] ?? ''}`,
        ),
        ...rejected
          .slice(0, 6)
          .map((b) => `REJECTED · ${b.name} — ${b.blockers.join('; ')}`),
        rejected.length > 6 ? `…and ${rejected.length - 6} more rejected.` : '',
        'Findings on the new prospects are unverified. Review them before any report or outreach.',
      ].filter(Boolean),
      navigateTo: (data.created ?? 0) > 0 ? '/leads?stage=researching' : undefined,
    };
  }

  // --- Uganda discovery -----------------------------------------------------
  if (/\buganda|discover|find (new )?(lead|prospect|business)/.test(cmd)) {
    const res = await fetch('/api/research/uganda', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'companies in Uganda', maxLeads: 3 }),
    });
    const data = (await res.json()) as {
      candidatesProposed?: number;
      candidatesReachable?: number;
      results?: { name: string; website: string; awaitingVerification: number }[];
      discarded?: { domain: string; reason: string }[];
      nextStep?: string;
      candidatesAreUnconfirmed?: boolean;
      error?: string;
    };
    if (!res.ok) return { text: data.error ?? 'Discovery failed.' };

    const found = data.results ?? [];
    return {
      text: found.length
        ? `Checked ${data.candidatesProposed ?? 0} candidate domain(s); ${found.length} responded and were recorded as prospects.`
        : `No candidate domain responded, so nothing was recorded. ${data.nextStep ?? ''}`,
      details: [
        ...found.map((r) => `${r.name} (${r.website}) — ${r.awaitingVerification} finding(s) need review`),
        ...(data.discarded ?? []).map((d) => `Discarded ${d.domain}: ${d.reason}`),
        data.candidatesAreUnconfirmed
          ? 'Names and industries came from automated discovery and are unconfirmed — verify before any outreach.'
          : '',
      ].filter(Boolean),
      navigateTo: found.length ? '/leads' : undefined,
    };
  }

  // --- Navigation -----------------------------------------------------------
  for (const nav of NAV) {
    if (nav.match.test(cmd)) return { text: `Opening ${nav.label}.`, navigateTo: nav.route };
  }
  if (/\b(lead|prospect|client|customer)\b/.test(cmd)) {
    return { text: 'Opening leads and prospects.', navigateTo: '/leads' };
  }

  if (/\b(help|what can you do)\b/.test(cmd)) {
    return {
      text: 'I can recall what has happened and help you decide who to approach.',
      details: [
        '"Brief me" — portfolio, work in progress and outreach state',
        '"Who should I pitch?" — ranked prospects with reasons and blockers',
        '"Pitch the best one" — drafts an approach for your review',
        '"What have we sent?" / "Show unsent drafts"',
        '"Tell me about <client>" — everything on record for that client',
        '"Find Uganda leads" — checks candidate domains and audits the ones that respond',
      ],
    };
  }

  // Fall back to a search rather than guessing an answer.
  return {
    text: `I do not have a direct answer for that, so I am searching leads for "${raw}".`,
    navigateTo: `/leads?q=${encodeURIComponent(raw)}`,
  };
}
