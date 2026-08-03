import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/auth-provider'

export const metadata: Metadata = {
  title: 'AROMAZEN AI - Enterprise AI Platform',
  description: 'Premium internal AI workspace for fragrance and cosmetic manufacturing',
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1c1c1c',
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
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
