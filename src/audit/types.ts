import type { CheckGroup, ObservationOutcome } from '@/lib/enums';

/** A single deterministic measurement. Checks return these; nothing else. */
export interface ObservationDraft {
  groupCode: CheckGroup;
  checkCode: string;
  outcome: ObservationOutcome;
  url?: string | null;
  /** Structured measurement - the number/string/list the check actually read. */
  rawValue?: Record<string, unknown>;
  /** Human-readable statement of what was measured. Neutral, no interpretation. */
  detail?: string | null;
  /** Populated when outcome is `unverifiable` or `skipped`. */
  reason?: string | null;
  evidence?: EvidenceDraft[];
  observedAt?: Date;
  source?: 'automated' | 'manual_pending' | 'manual_verified' | 'imported' | 'api';
}

export interface EvidenceDraft {
  kind:
    | 'http_response'
    | 'html_snippet'
    | 'header'
    | 'redirect_chain'
    | 'screenshot'
    | 'tls'
    | 'analyst_note'
    | 'api_response';
  sourceUrl?: string | null;
  contentType?: string | null;
  content?: string | null;
  bytes?: number | null;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  contentType: string | null;
  bytes: number;
  html: string | null;
  redirectChain: { url: string; status: number }[];
  elapsedMs: number;
  /** Set when the request could not complete. Never fabricated. */
  error?: {
    kind: 'dns' | 'connection' | 'timeout' | 'robots' | 'too_large' | 'redirect_loop' | 'other';
    message: string;
  };
  tls?: {
    valid: boolean;
    issuer?: string;
    subject?: string;
    validFrom?: string;
    validTo?: string;
    daysRemaining?: number;
    error?: string;
  };
}

/** Everything a check may read. Checks are pure functions of this. */
export interface AuditContext {
  organizationId: string;
  organizationName: string;
  country: string;
  city: string | null;
  targetUrl: string;
  origin: string;
  /** Root document, always fetched first. */
  root: FetchedPage;
  /** Additional pages fetched within the crawl budget, keyed by absolute URL. */
  pages: Map<string, FetchedPage>;
  robots: { fetched: boolean; body: string | null; allowsRoot: boolean };
  /** Fetch an additional URL within the run's budget. Returns null when exhausted. */
  fetch: (url: string, opts?: { method?: 'GET' | 'HEAD' }) => Promise<FetchedPage | null>;
  now: Date;
}

export interface CheckDefinition {
  group: CheckGroup;
  /** Stable machine code. Referenced by findings and by the classifier rules. */
  code: string;
  title: string;
  description: string;
  run: (ctx: AuditContext) => Promise<ObservationDraft[]> | ObservationDraft[];
}

export interface CheckGroupDefinition {
  group: CheckGroup;
  title: string;
  description: string;
  /** False when the group needs a credential or a human, not the crawler. */
  automated: boolean;
  run: (ctx: AuditContext) => Promise<ObservationDraft[]>;
}

/** Convenience builders keep the checks terse and consistent. */
export const obs = {
  pass(
    group: CheckGroup,
    code: string,
    detail: string,
    extra: Partial<ObservationDraft> = {},
  ): ObservationDraft {
    return { groupCode: group, checkCode: code, outcome: 'pass', detail, ...extra };
  },
  issue(
    group: CheckGroup,
    code: string,
    detail: string,
    extra: Partial<ObservationDraft> = {},
  ): ObservationDraft {
    return { groupCode: group, checkCode: code, outcome: 'issue', detail, ...extra };
  },
  info(
    group: CheckGroup,
    code: string,
    detail: string,
    extra: Partial<ObservationDraft> = {},
  ): ObservationDraft {
    return { groupCode: group, checkCode: code, outcome: 'info', detail, ...extra };
  },
  /**
   * The check could not run. This NEVER becomes a finding - it renders as
   * "Unable to verify automatically" with a manual-review action.
   */
  unverifiable(
    group: CheckGroup,
    code: string,
    reason: string,
    extra: Partial<ObservationDraft> = {},
  ): ObservationDraft {
    return {
      groupCode: group,
      checkCode: code,
      outcome: 'unverifiable',
      detail: 'Unable to verify automatically.',
      reason,
      ...extra,
    };
  },
  skipped(
    group: CheckGroup,
    code: string,
    reason: string,
    extra: Partial<ObservationDraft> = {},
  ): ObservationDraft {
    return { groupCode: group, checkCode: code, outcome: 'skipped', reason, ...extra };
  },
};
