// oxlint-disable react/only-export-components -- Next.js requires metadata exports beside the layout.
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '../index.css'
import '../App.css'
import { ServiceWorkerRegistration } from '../components/ServiceWorkerRegistration'
import { I18nProvider } from '../i18n/I18nProvider'

const description =
  'A privacy-first multilingual personal finance PWA for income, expenses, accounts, and recurring transactions.'

export const metadata: Metadata = {
  title: 'HushLedger · Personal finance',
  description,
  applicationName: 'HushLedger',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'HushLedger',
  },
  openGraph: {
    type: 'website',
    siteName: 'HushLedger',
    title: 'HushLedger · Personal finance',
    description,
  },
  twitter: {
    card: 'summary',
    title: 'HushLedger · Personal finance',
    description,
  },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#17483c',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>
        <I18nProvider>{children}</I18nProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
