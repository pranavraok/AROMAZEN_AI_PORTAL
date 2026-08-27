import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/auth-provider'
import { ToastProvider } from '@/components/ui/toast-provider'
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar'
import { InstallPromptProvider } from '@/components/install-prompt-provider'

export const metadata: Metadata = {
  title: 'Aromazen AI | Intelligence for modern fragrance teams',
  description: 'A secure AI workspace for Aromazen knowledge, operations, and creative work.',
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Aromazen AI" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <link rel="icon" href="/favicon.ico?v=2" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png?v=2" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=2" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2" />
      </head>
      <body className="bg-background text-foreground antialiased">
        <ServiceWorkerRegistrar />
        <InstallPromptProvider>
        <ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider>
        </InstallPromptProvider>
      </body>
    </html>
  )
}
