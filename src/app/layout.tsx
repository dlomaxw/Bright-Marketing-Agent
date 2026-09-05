import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BRAND } from '@/config/brand';

export const metadata: Metadata = {
  title: {
    default: `${BRAND.productName} — ${BRAND.companyName}`,
    template: `%s · ${BRAND.productName}`,
  },
  description: 'Marketing audit, proposal and outreach workspace for Bright Thoughts Services.',
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: BRAND.faviconPath, type: 'image/png' }],
    apple: [{ url: BRAND.faviconPath }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: BRAND.navy,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
