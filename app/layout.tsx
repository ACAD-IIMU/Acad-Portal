import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ACAD Student Portal',
  description: 'IIM Udaipur — ACAD Student Portal',
  // Lets students add the portal to their home screen — iPhones only show web
  // notifications (class alerts) for portals opened from the home screen.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ACAD', statusBarStyle: 'default' },
  icons: { apple: '/acad-logo.png' }
};

export const viewport: Viewport = {
  themeColor: '#9c2934'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
