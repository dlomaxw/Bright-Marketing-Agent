import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthError } from '@/server/auth/guard';
import { env } from '@/lib/env';

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Business rule violation - shown to the user verbatim. */
export const badRequest = (message: string, details?: unknown) =>
  new AppError(message, 400, details);
export const notFound = (what = 'Record') => new AppError(`${what} not found.`, 404);
export const conflict = (message: string, details?: unknown) =>
  new AppError(message, 409, details);

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Wraps a route handler with error translation, a correlation id and a CSRF
 * origin check on state-changing verbs.
 */
export function apiHandler<C>(
  fn: (req: NextRequest, ctx: C) => Promise<Response>,
): (req: NextRequest, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const requestId = randomUUID();
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
      const res = await fn(req, ctx);
      res.headers.set('x-request-id', requestId);
      return res;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin fetch from a server action carries no Origin
  let allowed: string;
  try {
    allowed = new URL(env.APP_URL).origin;
  } catch {
    return;
  }
  if (origin !== allowed && origin !== new URL(req.url).origin) {
    throw new AppError('Cross-origin request rejected.', 403);
  }
}

function errorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json(
      { error: err.message, requestId },
      { status: err.status, headers: { 'x-request-id': requestId } },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: 'The submitted data is not valid.',
        fieldErrors: err.flatten().fieldErrors,
        requestId,
      },
      { status: 422, headers: { 'x-request-id': requestId } },
    );
  }
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: err.message, details: err.details, requestId },
      { status: err.status, headers: { 'x-request-id': requestId } },
    );
  }

  console.error(JSON.stringify({ level: 'error', requestId, err: String(err), stack: (err as Error)?.stack }));
  return NextResponse.json(
    {
      error: `Something went wrong. Quote reference ${requestId} if you report this.`,
      requestId,
    },
    { status: 500, headers: { 'x-request-id': requestId } },
  );
}

/** Parse and validate a JSON body. */
export async function body<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
  return schema.parse(raw);
}

/** Parse and validate query parameters. */
export function query<S extends z.ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  return schema.parse(params);
}

export function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}
