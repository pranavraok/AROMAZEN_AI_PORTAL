import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/auth-provider'
import { ToastProvider } from '@/components/ui/toast-provider'

export const metadata: Metadata = {
  title: 'Aromazen AI | Intelligence for modern fragrance teams',
  description: 'A secure AI workspace for Aromazen knowledge, operations, and creative work.',
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#f8f7f3',
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
      <body className="bg-background text-foreground antialiased">
        <ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider>
      </body>
    </html>
  )
}
