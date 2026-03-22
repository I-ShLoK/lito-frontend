import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'LiTo - Listen Together',
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
        <meta name="theme-color" content="#0f1817" />
      </head>
      <body>
        <ThemeInit />
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'linear-gradient(140deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 38%, rgba(255,255,255,0.02) 100%), color-mix(in srgb, var(--surface) 66%, transparent)',
              color: 'var(--text-1)',
              border: '1px solid color-mix(in srgb, #ffffff 24%, var(--border))',
              borderRadius: 'var(--radius)',
              backdropFilter: 'blur(28px) saturate(150%)',
              WebkitBackdropFilter: 'blur(28px) saturate(150%)',
              boxShadow: '0 24px 45px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.28), 0 0 0 1px rgba(255,255,255,0.06)',
              fontFamily: 'Satoshi, system-ui, sans-serif',
              fontSize: '14px',
            },
            success: {
              iconTheme: { primary: 'var(--accent)', secondary: 'var(--bg)' },
            },
            error: {
              iconTheme: { primary: '#ff4444', secondary: 'var(--bg)' },
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
