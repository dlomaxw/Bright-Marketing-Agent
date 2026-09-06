import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { putObject } from '@/server/storage/r2';
import { createHash } from 'node:crypto';

/**
 * Captures a real screenshot of a prospect's page and stores it as evidence.
 *
 * This replaces `src/documents/screenshot.ts`, which draws a browser-shaped SVG
 * with issue badges positioned by index and never visits the site at all. That
 * was never embedded in a client document, which is the only reason it did no
 * harm: a drawing of someone's website presented as a screenshot of their
 * website is a fabricated observation, and the product forbids exactly that.
 *
 * The capture runs through Cloudflare Browser Rendering — a real headless
 * browser loading the real URL — because a serverless function cannot carry
 * Chromium and this account already has the capability. The returned PNG is
 * stored in R2 and recorded as `Evidence` of kind `screenshot`, carrying the
 * URL, the byte hash and the capture time, so it is subject to the same
 * freshness and provenance rules as every other piece of evidence.
 *
 * Politeness matches the crawler: a screenshot is one more request to a
 * third-party site, so it is taken once per audited page, not per finding.
 */

export interface CaptureResult {
  ok: boolean;
  evidenceId?: string;
  storageRef?: string;
  bytes?: number;
  /** Present when the capture could not be taken. Never guessed around. */
  reason?: string;
}

const ENDPOINT = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`;

/** True when a capture can be attempted at all. */
export function captureConfigured(): boolean {
  return env.CLOUDFLARE_ACCOUNT_ID.length > 0 && env.CLOUDFLARE_API_TOKEN.length > 0;
}

export async function captureScreenshot(args: {
  url: string;
  findingId?: string;
  observationId?: string;
  fullPage?: boolean;
  timeoutMs?: number;
}): Promise<CaptureResult> {
  if (!captureConfigured()) {
    return {
      ok: false,
      reason:
        'Screenshot capture needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Nothing has been drawn in its place.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);

  try {
    const response = await fetch(ENDPOINT(env.CLOUDFLARE_ACCOUNT_ID), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: args.url,
        screenshotOptions: { fullPage: args.fullPage ?? false, type: 'png' },
        viewport: { width: 1280, height: 800 },
        gotoOptions: { waitUntil: 'networkidle0', timeout: 25_000 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The body carries Cloudflare's own explanation; keep it rather than
      // paraphrasing, so a failure is diagnosable.
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        reason: `Browser rendering returned ${response.status}. ${detail.slice(0, 300)}`.trim(),
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      const detail = await response.text().catch(() => '');
      return { ok: false, reason: `Expected an image, received ${contentType}. ${detail.slice(0, 200)}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) {
      return { ok: false, reason: 'Browser rendering returned an empty image.' };
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const stored = await putObject({
      data: buffer,
      prefix: 'evidence',
      extension: 'png',
      contentType: 'image/png',
      metadata: { sourceUrl: args.url, capturedBy: 'cloudflare-browser-rendering' },
    });

    const evidence = await db.evidence.create({
      data: {
        findingId: args.findingId ?? null,
        observationId: args.observationId ?? null,
        kind: 'screenshot',
        sourceUrl: args.url,
        contentType: 'image/png',
        storageRef: stored.key,
        sha256,
        bytes: buffer.byteLength,
        capturedBy: 'cloudflare-browser-rendering',
      },
      select: { id: true },
    });

    return {
      ok: true,
      evidenceId: evidence.id,
      storageRef: stored.key,
      bytes: buffer.byteLength,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason:
        message.includes('abort')
          ? 'The page did not finish loading within the timeout, so no screenshot was taken.'
          : `Capture failed: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
