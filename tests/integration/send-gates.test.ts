import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { evaluateGates } from '@/server/emails/gates';
import { sendApprovedEmail } from '@/server/emails/send';
import { decideApproval, submitForApproval } from '@/server/approvals';
import type { SessionUser } from '@/server/auth/session';

/**
 * Behavioural tests for the send gates.
 *
 * These are the controls that stop a wrong or unsupported message reaching a
 * real business, so they are exercised against real rows rather than asserted
 * on structurally. Each test builds a draft that *should* be sendable, breaks
 * exactly one thing, and checks that the gate catches it.
 */

const FRESH = () => new Date();
const STALE = () => new Date(Date.now() - 60 * 24 * 3600_000);

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

interface Fixture {
  organizationId: string;
  contactId: string;
  findingId: string;
  draftId: string;
  author: SessionUser;
  approver: SessionUser;
}

async function ensureRoles() {
  for (const code of ['admin', 'auditor', 'sales', 'approver', 'viewer']) {
    await db.role.upsert({
      where: { code },
      create: { code, name: code, description: code },
      update: {},
    });
  }
}

async function makeUser(role: string, senior = false): Promise<SessionUser> {
  const email = `${uniq(role)}@test.example`;
  const user = await db.user.create({
    data: {
      name: `${role} user`,
      email,
      passwordHash: 'not-used',
      roleCode: role,
      seniorApprover: senior,
      signature: 'Test Sender\nBright Thoughts Services',
    },
  });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: role as SessionUser['role'],
    seniorApprover: senior,
    signature: user.signature,
  };
}

/** A draft that passes every gate. Individual tests then break one thing. */
async function buildSendableDraft(overrides: {
  sector?: string;
  contactVerified?: boolean;
  optedOut?: boolean;
  observedAt?: Date;
  findingVerified?: boolean;
  seniorApprover?: boolean;
} = {}): Promise<Fixture> {
  await ensureRoles();
  const author = await makeUser('sales');
  const approver = await makeUser('approver', overrides.seniorApprover ?? true);

  const org = await db.organization.create({
    data: {
      legalName: uniq('Test Org'),
      nameKey: uniq('test org'),
      website: 'https://example.test/',
      domainKey: uniq('example') + '.test',
      country: 'Uganda',
      sector: overrides.sector ?? 'standard',
    },
  });

  const contact = await db.contact.create({
    data: {
      organizationId: org.id,
      name: 'Jane Doe',
      email: `${uniq('jane')}@client.test`,
      emailKey: `${uniq('jane')}@client.test`,
      role: 'Managing Director',
      sourceUrl: 'https://example.test/contact',
      verificationStatus: overrides.contactVerified === false ? 'unverified' : 'verified',
      optedOut: overrides.optedOut ?? false,
      optOutAt: overrides.optedOut ? new Date() : null,
      isPrimary: true,
    },
  });

  const finding = await db.finding.create({
    data: {
      reference: uniq('BTS-T'),
      organizationId: org.id,
      checkCode: 'wp.default_pages',
      category: 'cms',
      severity: 'high',
      confidence: 'high',
      observation_text: 'The public page /sample-page/ returned HTTP 200 with default content.',
      businessImpact: 'Visitors may encounter content that does not represent the organization.',
      recommendation: 'Remove or redirect the page.',
      recommendedServiceCodes: '[]',
      evidenceUrl: 'https://example.test/sample-page/',
      observedAt: overrides.observedAt ?? FRESH(),
      verificationStatus: overrides.findingVerified === false ? 'auto_detected' : 'manually_verified',
      clientVisible: overrides.findingVerified !== false,
    },
  });

  const draft = await db.emailDraft.create({
    data: {
      organizationId: org.id,
      contactId: contact.id,
      version: 1,
      status: 'draft',
      subject: 'A quick observation about your website',
      body:
        'Hello Jane,\n\nWhile reviewing your public digital presence, we observed that the page ' +
        '/sample-page/ returns default content. This may affect how visitors judge the business.\n\n' +
        'Would you be available for a short discussion next week?\n\nKind regards,\nTest Sender',
      toEmail: contact.email,
      toName: contact.name,
      senderId: author.id,
      senderName: author.name,
      senderEmail: author.email,
      replyTo: author.email,
      authorId: author.id,
      findings: { create: [{ findingId: finding.id }] },
    },
  });

  return {
    organizationId: org.id,
    contactId: contact.id,
    findingId: finding.id,
    draftId: draft.id,
    author,
    approver,
  };
}

/** Takes a draft all the way to approved, by two different people. */
async function approve(fixture: Fixture): Promise<void> {
  await submitForApproval('email', fixture.draftId, fixture.author);
  await decideApproval('email', fixture.draftId, fixture.approver, 'approved');
}

const gate = (report: Awaited<ReturnType<typeof evaluateGates>>, key: string) =>
  report.gates.find((g) => g.key === key);

beforeEach(async () => {
  // Suppression is global, so it must not leak between tests.
  await db.suppressionEntry.deleteMany({});
});

describe('a fully correct draft', () => {
  it('passes every gate once approved by a second person', async () => {
    const fixture = await buildSendableDraft();
    await approve(fixture);

    const report = await evaluateGates(fixture.draftId);
    const failing = report.gates.filter((g) => g.status === 'fail');

    expect(failing.map((f) => `${f.key}: ${f.detail}`)).toEqual([]);
    expect(report.sendable).toBe(true);
  });
});

describe('recipient gates', () => {
  it('blocks an unverified contact', async () => {
    const fixture = await buildSendableDraft({ contactVerified: false });
    await approve(fixture);

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'recipient')?.status).toBe('fail');
    expect(gate(report, 'recipient')?.detail).toMatch(/unverified/i);
  });

  it('blocks a contact who has opted out', async () => {
    const fixture = await buildSendableDraft({ optedOut: true });
    await approve(fixture);

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'optout')?.status).toBe('fail');
    expect(gate(report, 'optout')?.detail).toMatch(/opted out/i);
  });

  it('blocks an address on the suppression list', async () => {
    const fixture = await buildSendableDraft();
    await approve(fixture);
    const draft = await db.emailDraft.findUnique({ where: { id: fixture.draftId } });

    await db.suppressionEntry.create({
      data: { emailKey: draft!.toEmail!.toLowerCase(), reason: 'complaint' },
    });

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'optout')?.detail).toMatch(/suppression list/i);
  });

  it('blocks when the draft address no longer matches the contact record', async () => {
    const fixture = await buildSendableDraft();
    await approve(fixture);

    await db.emailDraft.update({
      where: { id: fixture.draftId },
      data: { toEmail: 'someone.else@elsewhere.test' },
    });

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'recipient_match')?.status).toBe('fail');
  });
});

describe('evidence gates', () => {
  it('blocks stale evidence', async () => {
    const fixture = await buildSendableDraft({ observedAt: STALE() });
    await approve(fixture);

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'evidence')?.status).toBe('fail');
    expect(gate(report, 'evidence')?.detail).toMatch(/more than/i);
  });

  it('blocks a finding that has not been verified by a person', async () => {
    const fixture = await buildSendableDraft({ findingVerified: false });
    await approve(fixture);

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'evidence')?.detail).toMatch(/not been manually verified/i);
  });
});

describe('content gates', () => {
  it('blocks language this product does not allow', async () => {
    const fixture = await buildSendableDraft();
    await approve(fixture);

    await db.emailDraft.update({
      where: { id: fixture.draftId },
      data: {
        body:
          'Hello Jane,\n\nYour website is vulnerable and has been hacked. You are losing millions ' +
          'every month. We guarantee first page of Google.\n\nRegards,\nTest',
      },
    });

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'body')?.status).toBe('fail');
    expect(gate(report, 'body')?.detail).toMatch(/does not allow/i);
  });

  it('blocks unresolved placeholders', async () => {
    const fixture = await buildSendableDraft();
    await approve(fixture);

    await db.emailDraft.update({
      where: { id: fixture.draftId },
      data: { body: 'Hello [NAME],\n\nWe reviewed [ORGANIZATION] and found some issues to discuss.' },
    });

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'body')?.detail).toMatch(/placeholder/i);
  });
});

describe('approval gates', () => {
  it('blocks a draft that was never submitted', async () => {
    const fixture = await buildSendableDraft();

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'approval')?.status).toBe('fail');
    expect(gate(report, 'approval')?.detail).toMatch(/not been submitted/i);
  });

  it('blocks a draft that is still awaiting a decision', async () => {
    const fixture = await buildSendableDraft();
    await submitForApproval('email', fixture.draftId, fixture.author);

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'approval')?.status).toBe('fail');
  });

  it('refuses to let the submitter approve their own draft', async () => {
    const fixture = await buildSendableDraft();
    await submitForApproval('email', fixture.draftId, fixture.author);

    await expect(
      decideApproval('email', fixture.draftId, fixture.author, 'approved'),
    ).rejects.toThrow(/cannot approve it/i);
  });

  it('requires a comment when requesting changes', async () => {
    const fixture = await buildSendableDraft();
    await submitForApproval('email', fixture.draftId, fixture.author);

    await expect(
      decideApproval('email', fixture.draftId, fixture.approver, 'rejected'),
    ).rejects.toThrow(/comment is required/i);
  });
});

describe('sensitive sectors', () => {
  it('requires a senior approver', async () => {
    const fixture = await buildSendableDraft({ sector: 'health', seniorApprover: false });
    await approve(fixture);

    const report = await evaluateGates(fixture.draftId);
    expect(report.sendable).toBe(false);
    expect(gate(report, 'senior_approval')?.status).toBe('fail');
    expect(gate(report, 'senior_approval')?.detail).toMatch(/senior approver/i);
  });

  it('passes when a senior approver signed it off', async () => {
    const fixture = await buildSendableDraft({ sector: 'government', seniorApprover: true });
    await approve(fixture);

    const report = await evaluateGates(fixture.draftId);
    expect(gate(report, 'senior_approval')?.status).toBe('pass');
    expect(report.sendable).toBe(true);
  });
});

describe('sending', () => {
  it('refuses to send while any gate fails', async () => {
    const fixture = await buildSendableDraft({ contactVerified: false });
    await approve(fixture);

    await expect(sendApprovedEmail(fixture.draftId, fixture.approver)).rejects.toThrow(
      /cannot be sent/i,
    );

    const after = await db.emailDraft.findUnique({ where: { id: fixture.draftId } });
    expect(after?.sentAt).toBeNull();
    expect(after?.status).not.toBe('sent');
  });

  it('records the send and moves the organization to contacted', async () => {
    const fixture = await buildSendableDraft();
    await approve(fixture);

    const result = await sendApprovedEmail(fixture.draftId, fixture.approver);
    // EMAIL_PROVIDER=console, so nothing is transmitted.
    expect(result.status).toBe('recorded_manually');

    const draft = await db.emailDraft.findUnique({ where: { id: fixture.draftId } });
    expect(draft?.status).toBe('sent');
    expect(draft?.sentAt).not.toBeNull();
    expect(draft?.sendKey).toBeTruthy();

    const org = await db.organization.findUnique({ where: { id: fixture.organizationId } });
    expect(org?.stage).toBe('contacted');
    expect(org?.lastContactedAt).not.toBeNull();

    const message = await db.message.findFirst({ where: { emailDraftId: fixture.draftId } });
    expect(message?.direction).toBe('outbound');
  });

  it('prevents the same draft being sent twice', async () => {
    const fixture = await buildSendableDraft();
    await approve(fixture);
    await sendApprovedEmail(fixture.draftId, fixture.approver);

    await expect(sendApprovedEmail(fixture.draftId, fixture.approver)).rejects.toThrow(
      /cannot be sent|already/i,
    );

    const messages = await db.message.count({ where: { emailDraftId: fixture.draftId } });
    expect(messages).toBe(1);
  });

  it('enforces the frequency cap across drafts to the same organization', async () => {
    const first = await buildSendableDraft();
    await approve(first);
    await sendApprovedEmail(first.draftId, first.approver);

    // A second draft to the same organization, immediately afterwards.
    const second = await db.emailDraft.create({
      data: {
        organizationId: first.organizationId,
        contactId: first.contactId,
        version: 2,
        status: 'draft',
        subject: 'Following up',
        body: 'Hello Jane,\n\nFollowing up on my previous note about the page we observed.\n\nRegards,\nTest Sender',
        toEmail: (await db.contact.findUnique({ where: { id: first.contactId } }))!.email,
        toName: 'Jane Doe',
        senderId: first.author.id,
        senderName: first.author.name,
        senderEmail: first.author.email,
        authorId: first.author.id,
        findings: { create: [{ findingId: first.findingId }] },
      },
    });

    const report = await evaluateGates(second.id);
    expect(gate(report, 'frequency')?.status).toBe('fail');
    expect(gate(report, 'frequency')?.detail).toMatch(/cap/i);
    expect(report.sendable).toBe(false);
  });
});
