import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { drainQueue } from '@/server/audit/runner';
import { env } from '@/lib/env';

/**
 * Drains the audit queue on a short interval.
 *
 * The daily run queues the work; this is what actually performs it. They are
 * separate because the crawler is deliberately slow — one request per host with
 * a minimum interval between them — so a day's audits do not fit in one
 * function invocation and should not try to.
 *
 * Without this the queue has no consumer in production at all: the API drains
 * inline only in development, and a serverless host cannot run the long-lived
 * worker the deployment guide describes.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
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

  const startedAt = Date.now();
  const deadline = startedAt + 240_000;

  // Jobs whose invocation was killed mid-flight would otherwise stay claimed
  // forever. On a serverless host that is routine, not exceptional.
  const { count: reclaimed } = await db.auditJob.updateMany({
    where: {
      status: { in: ['claimed', 'running'] },
      claimedAt: { lt: new Date(Date.now() - 10 * 60_000) },
    },
    data: { status: 'queued', claimedAt: null, claimedBy: null },
  });

  let processed = 0;
  while (Date.now() < deadline - 30_000) {
    const done = await drainQueue(1);
    if (done === 0) break;
    processed += done;
  }

  const remaining = await db.auditJob.count({ where: { status: 'queued' } });

  return Response.json({
    processed,
    reclaimed,
    remaining,
    durationMs: Date.now() - startedAt,
  });
}

export const POST = GET;
