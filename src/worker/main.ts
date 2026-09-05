import 'dotenv/config';
import { drainQueue } from '@/server/audit/runner';
import { purgeExpiredSessions } from '@/server/auth/session';
import { db } from '@/lib/db';

/**
 * Audit worker.
 *
 * In production this runs as its own process (`npm run worker`) so a long crawl
 * never occupies a request thread. In development the API drains the queue
 * inline, so a single `npm run dev` is enough.
 *
 * The `AuditJob` table is the queue. Claims are optimistic (`updateMany` guarded
 * on `status: 'queued'`), so running several workers is safe.
 */

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
const HOUSEKEEPING_EVERY = 300; // ticks

let stopping = false;
let ticks = 0;

async function tick(): Promise<void> {
  const processed = await drainQueue(5);
  if (processed > 0) {
    console.log(JSON.stringify({ level: 'info', event: 'worker.processed', jobs: processed }));
  }

  ticks += 1;
  if (ticks % HOUSEKEEPING_EVERY === 0) {
    const purged = await purgeExpiredSessions();
    // Return jobs that were claimed but whose worker died.
    const { count: reclaimed } = await db.auditJob.updateMany({
      where: {
        status: { in: ['claimed', 'running'] },
        claimedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      data: { status: 'queued', claimedAt: null, claimedBy: null },
    });
    if (purged || reclaimed) {
      console.log(
        JSON.stringify({ level: 'info', event: 'worker.housekeeping', purgedSessions: purged, reclaimedJobs: reclaimed }),
      );
    }
  }
}

async function loop(): Promise<void> {
  console.log(JSON.stringify({ level: 'info', event: 'worker.started', pid: process.pid, pollMs: POLL_MS }));
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'worker.tick_failed', err: String(err) }));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await db.$disconnect();
  console.log(JSON.stringify({ level: 'info', event: 'worker.stopped' }));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    console.log(JSON.stringify({ level: 'info', event: 'worker.stopping', signal }));
    stopping = true;
  });
}

void loop();
