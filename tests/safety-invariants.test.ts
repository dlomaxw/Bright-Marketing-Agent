import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Structural guards against the class of regression that has already happened
 * once in this codebase.
 *
 * An earlier version of the autopilot and Uganda-research features marked every
 * finding `manually_verified` + `clientVisible: true` in bulk. That recorded
 * machine output as human-reviewed and put unreviewed claims in front of
 * clients — defeating the product's central rule while every unit test still
 * passed, because no test asserted on the shape of the code.
 *
 * These tests are deliberately structural. They are not a substitute for the
 * behavioural tests, they are a tripwire on the specific mistake.
 */

const SRC = path.resolve(__dirname, '../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((file) => ({
  path: path.relative(SRC, file).replace(/\\/g, '/'),
  source: readFileSync(file, 'utf8'),
}));

/**
 * Returns the text of every `data: { ... }` object literal in a source file.
 *
 * This is what separates an assignment from a query: `clientVisible: true`
 * inside a `where` clause is a perfectly good read ("count the client-facing
 * findings"), whereas the same text inside `data` publishes a claim. Matching
 * the file as a whole cannot tell those apart, so we match the write blocks
 * only, by scanning for balanced braces.
 */
function dataBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = /\bdata:\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    blocks.push(source.slice(match.index, i));
  }
  return blocks;
}

const assignsInData = (source: string, pattern: RegExp): boolean =>
  dataBlocks(source).some((block) => pattern.test(block));

describe('verification gate', () => {
  /**
   * Promoting a finding to `manually_verified` is a human act performed through
   * the findings endpoint, which checks the `finding.verify` permission and
   * records the reviewer. Nothing else may do it.
   */
  const ALLOWED_TO_VERIFY = ['app/api/findings/[id]/route.ts'];

  it('only the findings endpoint sets manually_verified', () => {
    const offenders = files
      .filter((f) => !ALLOWED_TO_VERIFY.includes(f.path))
      .filter((f) => assignsInData(f.source, /verificationStatus:\s*['"]manually_verified['"]/))
      .map((f) => f.path);

    expect(
      offenders,
      `These files assign manually_verified outside the human review endpoint:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * `clientVisible: true` is what puts a claim in front of a client. It may only
   * be set where a human explicitly asked for it.
   */
  const ALLOWED_TO_PUBLISH = ['app/api/findings/[id]/route.ts'];

  it('only the findings endpoint marks a finding client-facing', () => {
    const offenders = files
      .filter((f) => !ALLOWED_TO_PUBLISH.includes(f.path))
      .filter((f) => assignsInData(f.source, /clientVisible:\s*true/))
      .map((f) => f.path);

    expect(
      offenders,
      `These files publish findings to clients directly:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('no bulk updateMany promotes findings', () => {
    // Demotion in bulk is fine and necessary — `markResolvedFindings` sets
    // `clientVisible: false` when a check starts passing. Only promotion is
    // forbidden.
    const offenders = files
      .filter((f) => /finding\.updateMany/.test(f.source))
      .filter((f) =>
        assignsInData(f.source, /verificationStatus:\s*['"]manually_verified['"]|clientVisible:\s*true/),
      )
      .map((f) => f.path);

    expect(
      offenders,
      `Bulk promotion of findings found in:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('agent memory', () => {
  it('is read-only', () => {
    const memory = files.find((f) => f.path === 'server/agent/memory.ts');
    expect(memory, 'server/agent/memory.ts should exist').toBeDefined();

    const writes = /db\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.exec(
      memory!.source,
    );
    expect(
      writes?.[0],
      `The assistant's memory must not write to the database, found: ${writes?.[0]}`,
    ).toBeUndefined();
  });
});

describe('outreach', () => {
  it('sending always re-evaluates the gates', () => {
    const send = files.find((f) => f.path === 'server/emails/send.ts');
    expect(send).toBeDefined();
    expect(send!.source).toMatch(/evaluateGates\(/);
    // The result must actually be checked, not merely computed.
    expect(send!.source).toMatch(/sendable/);
  });

  /**
   * The only code that may actually transmit a message is the transport in
   * `smtp.ts`, and the only thing allowed to call it is `send.ts`, which runs
   * the gates first. Merely mentioning SMTP is fine — the readiness checks have
   * to — so this asserts on the act of sending, not on the word.
   */
  it('only the transport module transmits a message', () => {
    const offenders = files
      .filter((f) => f.path !== 'server/emails/smtp.ts')
      .filter((f) => /\.sendMail\s*\(|createTransport\s*\(/.test(f.source))
      .map((f) => f.path);

    expect(
      offenders,
      `These modules transmit mail directly instead of going through the send path:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('only the gated send path invokes the transport', () => {
    const allowed = ['server/emails/send.ts', 'server/emails/smtp.ts'];
    const offenders = files
      .filter((f) => !allowed.includes(f.path))
      .filter((f) => /\bdeliverBySmtp\b/.test(f.source))
      .map((f) => f.path);

    expect(
      offenders,
      `deliverBySmtp must only be reached through send.ts, which runs the gates first. Found in:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the transport is never reached without the gates passing', () => {
    const send = files.find((f) => f.path === 'server/emails/send.ts');
    expect(send).toBeDefined();
    // The gate evaluation must appear before the delivery call in the file.
    const gateAt = send!.source.indexOf('evaluateGates(');
    const deliverAt = send!.source.indexOf('await deliver(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(deliverAt).toBeGreaterThan(-1);
    expect(gateAt, 'gates must be evaluated before delivery').toBeLessThan(deliverAt);
  });
});

describe('prospect records', () => {
  it('research does not store model-supplied contact details', () => {
    const research = files.find((f) => f.path === 'server/leads/uganda-research.ts');
    expect(research).toBeDefined();

    // The model is asked for domains only. A prompt requesting phone numbers or
    // email addresses would mean fabricated contact details for real people.
    const prompt = research!.source;
    expect(prompt).toMatch(/Do NOT return telephone numbers/i);
    expect(prompt).not.toMatch(/"phone"\s*:/);
  });
});

describe('audience metrics', () => {
  /**
   * A follower count in a client document is checkable in one click, so it may
   * only come from an authorized platform API — never from a person typing what
   * they thought they saw, and never from a request body.
   */
  it('only the review audit writes follower counts', () => {
    const offenders = files
      .filter((f) => f.path !== 'server/leads/review-audit.ts')
      .filter((f) => assignsInData(f.source, /followers:/))
      .map((f) => f.path);

    expect(
      offenders,
      `These files write follower counts outside the authorized-API path:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the platform review endpoint restricts answers to the defined checklist', () => {
    const route = files.find(
      (f) => f.path === 'app/api/organizations/[id]/profiles/[profileId]/route.ts',
    );
    expect(route, 'the platform review endpoint is missing').toBeDefined();

    // Without this the endpoint would accept any key, which is how an
    // unverified metric reaches a profile record.
    expect(route!.source).toMatch(/checklistFor\(/);
    expect(route!.source).toMatch(/Unrecognised checklist item/);
  });
});

describe('the scheduled agent', () => {
  /**
   * The agent runs every day with nobody watching. Everything that makes that
   * acceptable is the set of things it does NOT do, so those are asserted here
   * rather than left to the reading of a comment.
   */
  const agent = () => files.find((f) => f.path === 'server/agent/daily.ts');

  it('exists', () => {
    expect(agent(), 'server/agent/daily.ts is missing').toBeDefined();
  });

  it('never verifies a finding or publishes one to a client', () => {
    const source = agent()!.source;
    expect(
      assignsInData(source, /verificationStatus:\s*['"]manually_verified['"]/),
      'the scheduled agent must not verify findings',
    ).toBe(false);
    expect(
      assignsInData(source, /clientVisible:\s*true/),
      'the scheduled agent must not publish findings to clients',
    ).toBe(false);
  });

  it('never sends email', () => {
    const source = agent()!.source;
    // Delivery goes through emails/send.ts, which re-evaluates every gate.
    // Reaching the transport or the send path directly would bypass them.
    expect(source).not.toMatch(/sendMail|deliverBySmtp|from '@\/server\/emails\/send'/);
  });

  it('the cron endpoints refuse to run without a configured secret', () => {
    for (const path of ['app/api/cron/daily/route.ts', 'app/api/cron/drain/route.ts']) {
      const route = files.find((f) => f.path === path);
      expect(route, `${path} is missing`).toBeDefined();
      // An unauthenticated endpoint here would let anyone queue crawls of
      // hundreds of third-party websites in this agency's name.
      expect(route!.source).toMatch(/CRON_SECRET/);
      expect(route!.source).toMatch(/401/);
    }
  });
});
