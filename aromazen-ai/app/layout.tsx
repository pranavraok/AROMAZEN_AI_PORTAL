import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/auth-provider'
import { ToastProvider } from '@/components/ui/toast-provider'
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar'
import { InstallPromptProvider } from '@/components/install-prompt-provider'
import { MobileAppLaunch } from '@/components/mobile-app-launch'

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
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{if((matchMedia('(display-mode: standalone)').matches||navigator.standalone===true)&&matchMedia('(max-width: 767px)').matches&&sessionStorage.getItem('aromazen:mobile-app-active')!=='1'){document.documentElement.classList.add('mobile-app-launch-pending')}}catch(e){}" }} />
        <link rel="manifest" href="/manifest.json?v=5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Aromazen AI" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <link rel="icon" href="/favicon.ico?v=4" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/aromazen-favicon-light-v4.png" media="(prefers-color-scheme: light)" />
        <link rel="icon" type="image/png" sizes="32x32" href="/aromazen-favicon-dark-v4.png" media="(prefers-color-scheme: dark)" />
        <link rel="icon" type="image/png" sizes="16x16" href="/aromazen-favicon-light-16-v4.png" media="(prefers-color-scheme: light)" />
        <link rel="icon" type="image/png" sizes="16x16" href="/aromazen-favicon-dark-16-v4.png" media="(prefers-color-scheme: dark)" />
      </head>
      <body className="bg-background text-foreground antialiased">
        <ServiceWorkerRegistrar />
        <InstallPromptProvider>
        <ToastProvider><AuthProvider><MobileAppLaunch />{children}</AuthProvider></ToastProvider>
        </InstallPromptProvider>
      </body>
    </html>
  )
}
