import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge-level gate. This only checks for the presence of a session cookie so an
 * unauthenticated visitor is redirected without a database round trip.
 *
 * It is NOT the authorization boundary - the cookie is verified and the role is
 * checked in `requirePageUser` / `requirePermission` on the server for every
 * request. A forged cookie gets past this and fails there.
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has('bs_session');
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
