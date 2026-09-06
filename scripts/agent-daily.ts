import 'dotenv/config';
import { runDailyAgent } from '../src/server/agent/daily';

/**
 * Runs the scheduled agent by hand — the same code path the cron invokes.
 *
 *   npm run agent:daily
 *   npm run agent:daily -- --budget 60
 */

async function main() {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const budgetSeconds = Number(arg('budget') ?? 240);

  const result = await runDailyAgent({ budgetMs: budgetSeconds * 1000 });

  console.log(`\nDaily agent — ${(result.durationMs / 1000).toFixed(1)}s\n`);
  for (const step of result.steps) console.log(`  ${step}`);

  console.log('\nWaiting for a person:');
  console.log(`  findings to verify:     ${result.awaitingHumanReview.findingsUnverified}`);
  console.log(`  reports to approve:     ${result.awaitingHumanReview.reportsAwaitingApproval}`);
  console.log(`  proposals to approve:   ${result.awaitingHumanReview.proposalsAwaitingApproval}`);
  console.log('\nThe agent never verifies a finding and never sends email.');
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
