import type { NextRequest } from 'next/server';
import { runDailyAgent } from '@/server/agent/daily';
import { env } from '@/lib/env';

/**
 * The scheduled entry point for the daily agent.
 *
 * Authentication is a shared secret, not a session: the caller is the host's
 * scheduler, which has no user. Vercel sends `Authorization: Bearer
 * $CRON_SECRET` on scheduled invocations.
 *
 * Without CRON_SECRET set, the endpoint refuses every request rather than
 * running unauthenticated. An open endpoint that queues crawls of hundreds of
 * third-party websites is an endpoint someone else can point at those
 * websites, in this agency's name.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  // Constant-time-ish comparison: length is checked first, then every byte.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!authorised(req)) {
    return Response.json(
      { error: env.CRON_SECRET ? 'Unauthorized.' : 'CRON_SECRET is not configured, so scheduled runs are disabled.' },
      { status: 401 },
    );
  }

  try {
    // Leaves headroom inside the 300s function limit to return a response.
    const result = await runDailyAgent({ budgetMs: 240_000 });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', event: 'agent.daily_failed', err: message }));
    return Response.json({ error: message }, { status: 500 });
  }
}

/** POST behaves identically, so the run can be triggered by hand. */
export const POST = GET;
