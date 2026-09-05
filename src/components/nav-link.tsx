'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export function NavLink({
  href,
  children,
  badge,
}: {
  href: string;
  children: ReactNode;
  badge?: number;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition',
        active ? 'bg-white/12 font-semibold text-white' : 'text-white/70 hover:bg-white/8 hover:text-white',
      )}
    >
      <span className="truncate">{children}</span>
      {badge !== undefined && badge > 0 && (
        <span className="shrink-0 rounded bg-gold px-1.5 text-[11px] font-bold text-navy tabular-nums">
          {badge}
        </span>
      )}
    </Link>
  );
}
