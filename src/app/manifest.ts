import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'HushLedger · Personal Finance',
    short_name: 'HushLedger',
    description: 'Privacy-first multilingual income, expense, and recurring transaction tracker',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f6f2',
    theme_color: '#17483c',
    icons: [
      { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
