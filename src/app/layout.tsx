import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'LiTo — Listen Together',
  description: 'Synchronized music listening rooms',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LiTo" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0a0000" />
      </head>
      <body>
        <ThemeInit />
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'color-mix(in srgb, var(--surface) 90%, transparent)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)',
              borderRadius: '14px',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
              fontFamily: 'Satoshi, system-ui, sans-serif',
              fontSize: '14px',
            },
            success: {
              iconTheme: { primary: 'var(--accent)', secondary: 'var(--bg)' },
            },
            error: {
              iconTheme: { primary: '#f87171', secondary: 'var(--bg)' },
            },
          }}
        />
      </body>
    </html>
  );
}

function ThemeInit() {
  const script = `
    (function() {
      try {
        var raw = localStorage.getItem('lito-store');
        if (raw) {
          var s = JSON.parse(raw);
          if (s.state && s.state.theme === 'mono') {
            document.documentElement.setAttribute('data-theme', 'mono');
          }
        }
      } catch(e) {}
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
