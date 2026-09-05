import Link from 'next/link';
import { buttonClass } from '@/components/ui';

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-navy">You do not have access to that screen</h1>
      <p className="mt-2 text-[13px] text-muted">
        Your role does not include this permission. If you need it, ask an administrator to review
        your role in Settings.
      </p>
      <div className="mt-5">
        <Link href="/" className={buttonClass('primary')}>
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
