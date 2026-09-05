import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/auth/session';
import { BRAND } from '@/config/brand';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect('/');
  const { next } = await searchParams;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel. Flat navy, no gradient, per the design direction. */}
      <div className="hidden flex-col justify-between bg-navy px-10 py-10 text-white lg:flex">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            {BRAND.companyName}
          </p>
          <p className="mt-8 text-3xl font-semibold leading-tight">{BRAND.productName}</p>
          <p className="mt-2 max-w-sm text-sm text-white/70">
            Turn verified observations about a prospect&rsquo;s digital presence into an
            evidence-based report, a costed proposal and an approved message.
          </p>
        </div>

        <ul className="max-w-sm space-y-3 text-[13px] text-white/75">
          {[
            'Every client-facing finding carries a URL, a timestamp and a confidence level.',
            'Reports and proposals are drafted from verified findings only.',
            'No message is sent until a second person approves the recipient and the content.',
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-white/40">
          Internal workspace. Public business information is used for legitimate B2B outreach only.
        </p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              {BRAND.companyName}
            </p>
            <p className="mt-1 text-2xl font-semibold text-navy">{BRAND.productName}</p>
          </div>
          <h1 className="mt-6 text-lg font-semibold text-navy lg:mt-0">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">
            Use the account issued to you by an administrator.
          </p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
