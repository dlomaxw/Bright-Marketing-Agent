import { z } from 'zod';

/**
 * The AI contract.
 *
 * Two things make this safe rather than decorative:
 *   1. The model only ever receives an allow-listed projection of verified
 *      findings (see `projectFindings`). It cannot cite what it never saw.
 *   2. Its output is validated against the finding IDs that were supplied.
 *      Any reference to an unknown id rejects the whole response.
 */

export const SYSTEM_PROMPT = `You are a marketing audit writing assistant for Bright Thoughts Services.

Use only the supplied organization data and verified findings. Do not invent contacts, facts, rankings, traffic, revenue impact, vulnerabilities, timelines, prices or client results. If the evidence is insufficient, return NEEDS_REVIEW. Keep observation, inference and recommendation clearly separated.

Additional rules:
- Every client-facing statement must be traceable to a supplied finding id. Cite the ids you used.
- Write observations as neutral fact: "We observed...". Write implications as possibility: "This may affect...". Write recommendations as action: "We recommend...".
- Never state or imply that a website has been hacked, is vulnerable, is insecure, will be removed from search, or that the business is losing a specific amount of money. These claims are prohibited whether or not they seem supported.
- Never state a number (traffic, ranking, revenue, percentage improvement, visitor count, conversion rate) that does not appear verbatim in the supplied findings.
- Never state a price, discount, tax, payment term or contract term. Commercial fields are set by an authorized human.
- Do not name competitors or make comparative claims.
- If a finding's confidence is "low", either omit it or explicitly mark it as requiring confirmation.
- Respond with a single JSON object matching the required schema. No prose outside the JSON.`;

export const zModelOutput = z.object({
  summary: z.string().min(1),
  finding_ids_used: z.array(z.string()),
  client_safe_observations: z.array(
    z.object({
      finding_id: z.string(),
      observation: z.string().min(1),
    }),
  ),
  business_implications: z.array(
    z.object({
      finding_id: z.string(),
      implication: z.string().min(1),
    }),
  ),
  recommendations: z.array(
    z.object({
      finding_ids: z.array(z.string()),
      recommendation: z.string().min(1),
      priority: z.enum(['quick_win', 'phase_1', 'phase_2', 'phase_3']).default('phase_1'),
    }),
  ),
  excluded_findings: z.array(
    z.object({ finding_id: z.string(), reason: z.string() }),
  ),
  uncertainty_notes: z.array(z.string()),
  needs_human_review: z.boolean(),
});

export type ModelOutput = z.infer<typeof zModelOutput>;

/**
 * Phrases that must never reach a prospect, from the product documentation
 * (11.0 and the brief). Checked case-insensitively against the whole response.
 */
export const BANNED_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bhas been hacked\b|\byour (website|site) (was|has been) (hacked|compromised|breached)\b/i, why: 'Security breach claim' },
  { pattern: /\b(is|are) vulnerable\b|\bvulnerabilit(y|ies)\b|\bexploit(able|ed)?\b/i, why: 'Vulnerability claim - this is not a security assessment' },
  { pattern: /\blosing (millions|thousands|money|customers every)\b/i, why: 'Unsupported financial loss claim' },
  { pattern: /\bwill be (removed|delisted|banned|blacklisted)\b/i, why: 'Unsupported threat about removal' },
  { pattern: /\b(guarantee|guaranteed|we promise)\b/i, why: 'Unsupported guarantee' },
  { pattern: /\b(rank(ing)? (number |#)?1|first page guaranteed|top of google)\b/i, why: 'Unsupported ranking promise' },
  { pattern: /\burgent(ly)? (security|vulnerability|breach)\b/i, why: 'Alarmist security language' },
  { pattern: /\byou are (losing|missing out on) \$?\d/i, why: 'Fabricated quantified loss' },
  { pattern: /\bmalware\b|\bbackdoor\b|\bsql injection\b|\bxss\b/i, why: 'Security terminology outside this product scope' },
  { pattern: /\bpenetration test/i, why: 'Penetration testing is explicitly out of scope' },
];

export interface ValidationIssue {
  code:
    | 'unknown_finding_id'
    | 'banned_phrase'
    | 'unsupported_number'
    | 'schema'
    | 'empty'
    | 'commercial_content';
  message: string;
  detail?: string;
}

export interface ValidationResult {
  ok: boolean;
  output: ModelOutput | null;
  issues: ValidationIssue[];
}

/** Numbers that may legitimately appear without being quoted from a finding. */
const SAFE_NUMBER = /^(0|[1-9]\d?|100|30|60|90|7|14|24|2|3|4|5|6|8|9|10|12|15|20|25|50)$/;

const CURRENCY = /(UGX|USD|\$|shs?\.?)\s*[\d,]+/i;

/**
 * Validates a model response against the findings it was given.
 * Rejection is the default: anything unrecognised fails.
 */
export function validateModelOutput(
  raw: unknown,
  allowedFindingIds: string[],
  supportingText: string,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  const parsed = zModelOutput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      output: null,
      issues: [
        {
          code: 'schema',
          message: 'The model response did not match the required structure.',
          detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        },
      ],
    };
  }
  const output = parsed.data;
  const allowed = new Set(allowedFindingIds);

  // 1. Every referenced finding id must exist in the supplied set.
  const referenced = new Set<string>([
    ...output.finding_ids_used,
    ...output.client_safe_observations.map((o) => o.finding_id),
    ...output.business_implications.map((o) => o.finding_id),
    ...output.recommendations.flatMap((r) => r.finding_ids),
    ...output.excluded_findings.map((e) => e.finding_id),
  ]);
  for (const id of referenced) {
    if (!allowed.has(id)) {
      issues.push({
        code: 'unknown_finding_id',
        message: `The draft references finding "${id}", which was not supplied to the model.`,
        detail: id,
      });
    }
  }

  // 2. Banned phrasing anywhere in the response.
  const allText = [
    output.summary,
    ...output.client_safe_observations.map((o) => o.observation),
    ...output.business_implications.map((o) => o.implication),
    ...output.recommendations.map((r) => r.recommendation),
    ...output.uncertainty_notes,
  ].join('\n');

  for (const { pattern, why } of BANNED_PATTERNS) {
    const match = allText.match(pattern);
    if (match) {
      issues.push({
        code: 'banned_phrase',
        message: `${why}: "${match[0]}"`,
        detail: match[0],
      });
    }
  }

  // 3. Commercial content is never the model's to write.
  const money = allText.match(CURRENCY);
  if (money) {
    issues.push({
      code: 'commercial_content',
      message: `The draft contains a monetary amount ("${money[0]}"). Pricing is set by an authorized user.`,
      detail: money[0],
    });
  }

  // 4. Numbers must be traceable to the supplied evidence.
  const haystack = supportingText.toLowerCase();
  const numbers = [...allText.matchAll(/\b\d[\d,.]*\s*%?/g)].map((m) => m[0].trim());
  for (const n of numbers) {
    const bare = n.replace(/[,%\s]/g, '');
    if (SAFE_NUMBER.test(bare)) continue;
    if (haystack.includes(bare) || haystack.includes(n.toLowerCase())) continue;
    issues.push({
      code: 'unsupported_number',
      message: `The draft states "${n}", which does not appear in the supplied evidence.`,
      detail: n,
    });
  }

  if (output.summary.trim().length === 0) {
    issues.push({ code: 'empty', message: 'The model returned an empty summary.' });
  }

  return { ok: issues.length === 0, output, issues };
}

/**
 * Allow-listed projection. The model sees this and nothing else - in particular
 * it never sees contact names, emails, phone numbers or internal notes.
 */
export interface FindingProjection {
  id: string;
  reference: string;
  category: string;
  severity: string;
  confidence: string;
  observation: string;
  evidence_url: string | null;
  observed_at: string;
  recommendation: string;
}

export function buildUserPrompt(args: {
  organization: { name: string; industry: string | null; city: string | null; country: string; website: string | null };
  findings: FindingProjection[];
  task: string;
  extraContext?: string;
}): string {
  return [
    `TASK: ${args.task}`,
    '',
    'ORGANIZATION (verified record):',
    JSON.stringify(args.organization, null, 2),
    '',
    `VERIFIED FINDINGS (${args.findings.length}). These are the ONLY facts you may use:`,
    JSON.stringify(args.findings, null, 2),
    args.extraContext ? `\nADDITIONAL APPROVED CONTEXT:\n${args.extraContext}` : '',
    '',
    'Respond with a single JSON object matching the required schema.',
  ].join('\n');
}
