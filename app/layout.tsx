import type { Metadata } from 'next'
import './globals.css'

// Replaces index.html's <head> -- Next's metadata API generates the equivalent tags. A non-component export
// alongside the default one is the standard, required App Router convention here, not a fast-refresh hazard.
// oxlint-disable-next-line react/only-export-components
export const metadata: Metadata = {
  title: 'Octaraa Wills — Draft your Will',
  icons: {
    icon: [
      { url: '/octaraa-favicon.png', sizes: '96x96', type: 'image/png' },
      { url: '/octaraa-favicon.ico', sizes: '16x16 32x32', type: 'image/x-icon' },
    ],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Kept as plain links (not next/font) for this port: identical output to the current Vite build,
            swapping to next/font is a follow-up optimization, not part of the migration itself. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Lexend:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
