import { env, integrations } from '@/lib/env';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  validateModelOutput,
  type FindingProjection,
  type ModelOutput,
  type ValidationResult,
} from './contract';

/**
 * Model access, behind an interface.
 *
 * The deterministic provider is not a stub: it is the product's default. With
 * no API key the app still produces a complete, evidence-linked draft built
 * directly from the finding catalogue. AI improves the prose; it is never
 * required for the workflow to complete.
 */

export interface DraftRequest {
  organization: {
    name: string;
    industry: string | null;
    city: string | null;
    country: string;
    website: string | null;
  };
  findings: FindingProjection[];
  task: string;
  extraContext?: string;
}

export interface DraftResult extends ValidationResult {
  provider: 'gemini' | 'anthropic' | 'deterministic';
  model: string | null;
  /** Present when the model produced output that failed validation. */
  rejectedRaw?: unknown;
}

export interface ModelProvider {
  readonly name: 'gemini' | 'anthropic' | 'deterministic';
  draft(req: DraftRequest): Promise<DraftResult>;
}

// ---------------------------------------------------------------------------
// Deterministic provider
// ---------------------------------------------------------------------------

class DeterministicProvider implements ModelProvider {
  readonly name = 'deterministic' as const;

  async draft(req: DraftRequest): Promise<DraftResult> {
    const usable = req.findings.filter((f) => f.confidence !== 'low');
    const excluded = req.findings.filter((f) => f.confidence === 'low');

    const bySeverity = [...usable].sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity),
    );

    const output: ModelOutput = {
      summary: usable.length
        ? `We reviewed the public digital presence of ${req.organization.name} and verified ${usable.length} ${usable.length === 1 ? 'issue' : 'issues'}. The most significant relate to ${[...new Set(bySeverity.slice(0, 3).map((f) => f.category))].join(', ')}. Each observation below is linked to the page where it was recorded and the date it was checked.`
        : `We reviewed the public digital presence of ${req.organization.name}. No verified findings are currently available for a client-facing summary.`,
      finding_ids_used: usable.map((f) => f.id),
      client_safe_observations: usable.map((f) => ({
        finding_id: f.id,
        observation: `We observed that ${lowerFirst(f.observation)}`,
      })),
      business_implications: usable.map((f) => ({
        finding_id: f.id,
        implication: implicationFor(f),
      })),
      recommendations: bySeverity.map((f) => ({
        finding_ids: [f.id],
        recommendation: `We recommend the following: ${lowerFirst(f.recommendation)}`,
        priority: priorityFor(f.severity),
      })),
      excluded_findings: excluded.map((f) => ({
        finding_id: f.id,
        reason: 'Confidence is low; confirm manually before including this in client-facing output.',
      })),
      uncertainty_notes:
        excluded.length > 0
          ? [
              `${excluded.length} low-confidence finding(s) were excluded and require manual confirmation.`,
            ]
          : [],
      needs_human_review: usable.length === 0,
    };

    const supporting = JSON.stringify(req.findings);
    const validation = validateModelOutput(output, req.findings.map((f) => f.id), supporting);

    return { ...validation, provider: 'deterministic', model: null };
  }
}

const severityRank = (s: string) =>
  ({ critical: 5, high: 4, medium: 3, low: 2, informational: 1 })[s] ?? 0;

const priorityFor = (s: string): ModelOutput['recommendations'][number]['priority'] =>
  s === 'critical' ? 'quick_win' : s === 'high' ? 'phase_1' : s === 'medium' ? 'phase_2' : 'phase_3';

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function implicationFor(f: FindingProjection): string {
  const map: Record<string, string> = {
    availability: 'This may prevent visitors from reaching the business online.',
    cms: 'This may give visitors the impression that the site is unfinished.',
    seo: 'This may affect how easily the business is found in search results.',
    content: 'This may make it harder for visitors to understand what is offered.',
    performance: 'This may slow the page for visitors on mobile connections.',
    mobile: 'This may make the site harder to use on a phone.',
    accessibility: 'This may make the site harder to use for people using assistive technology.',
    conversion: 'This may reduce the number of visitors who make an enquiry.',
    trust: 'This may affect how visitors judge the credibility of the business.',
    social: 'This may reduce the consistency of the brand across channels.',
    local: 'This may affect visibility for people searching nearby.',
  };
  return map[f.category] ?? 'This may affect the experience of visitors to the site.';
}

// ---------------------------------------------------------------------------
// Gemini provider
// ---------------------------------------------------------------------------

class GeminiProvider implements ModelProvider {
  readonly name = 'gemini' as const;
  private fallback = new DeterministicProvider();

  async draft(req: DraftRequest): Promise<DraftResult> {
    const prompt = buildUserPrompt(req);
    const model = env.GEMINI_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    let raw: unknown;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const detail = await res.text();
        return {
          ...(await this.fallback.draft(req)),
          issues: [
            {
              code: 'schema',
              message: `The Gemini AI service returned HTTP ${res.status}. A deterministic draft was produced instead.`,
              detail: detail.slice(0, 500),
            },
          ],
          ok: true,
          provider: 'deterministic',
          model: null,
        };
      }

      const payload = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      raw = JSON.parse(extractJson(text));
    } catch (err) {
      const fb = await this.fallback.draft(req);
      return {
        ...fb,
        provider: 'deterministic',
        model: null,
        issues: [
          {
            code: 'schema',
            message: 'The Gemini AI service could not be reached. A deterministic draft was produced instead.',
            detail: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }

    const validation = validateModelOutput(
      raw,
      req.findings.map((f) => f.id),
      JSON.stringify(req.findings),
    );

    if (!validation.ok) {
      const fb = await this.fallback.draft(req);
      return {
        ok: false,
        output: fb.output,
        issues: validation.issues,
        provider: 'gemini',
        model,
        rejectedRaw: raw,
      };
    }

    return { ...validation, provider: 'gemini', model };
  }
}

// ---------------------------------------------------------------------------
// Anthropic provider
// ---------------------------------------------------------------------------

class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic' as const;
  private fallback = new DeterministicProvider();

  async draft(req: DraftRequest): Promise<DraftResult> {
    const prompt = buildUserPrompt(req);

    let raw: unknown;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: env.AI_MODEL,
          max_tokens: 4096,
          temperature: 0.2,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const detail = await res.text();
        return {
          ...(await this.fallback.draft(req)),
          issues: [
            {
              code: 'schema',
              message: `The AI service returned HTTP ${res.status}. A deterministic draft was produced instead.`,
              detail: detail.slice(0, 500),
            },
          ],
          ok: true,
          provider: 'deterministic',
          model: null,
        };
      }

      const payload = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = payload.content?.find((c) => c.type === 'text')?.text ?? '';
      raw = JSON.parse(extractJson(text));
    } catch (err) {
      const fb = await this.fallback.draft(req);
      return {
        ...fb,
        provider: 'deterministic',
        model: null,
        issues: [
          {
            code: 'schema',
            message: 'The AI service could not be reached. A deterministic draft was produced instead.',
            detail: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }

    const validation = validateModelOutput(
      raw,
      req.findings.map((f) => f.id),
      JSON.stringify(req.findings),
    );

    if (!validation.ok) {
      // Rejected output is never shown as prose. Return the deterministic draft
      // and surface the reasons so a human can see what the model tried to say.
      const fb = await this.fallback.draft(req);
      return {
        ok: false,
        output: fb.output,
        issues: validation.issues,
        provider: 'anthropic',
        model: env.AI_MODEL,
        rejectedRaw: raw,
      };
    }

    return { ...validation, provider: 'anthropic', model: env.AI_MODEL };
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

let cached: ModelProvider | null = null;

export function modelProvider(): ModelProvider {
  if (!cached) {
    if (env.AI_PROVIDER === 'gemini' || (env.AI_PROVIDER === 'auto' && integrations.gemini)) {
      cached = new GeminiProvider();
    } else if (env.AI_PROVIDER === 'anthropic' || (env.AI_PROVIDER === 'auto' && integrations.anthropic)) {
      cached = new AnthropicProvider();
    } else {
      cached = new DeterministicProvider();
    }
  }
  return cached;
}

export function providerName(): 'gemini' | 'anthropic' | 'deterministic' {
  const provider = modelProvider();
  return provider.name;
}

