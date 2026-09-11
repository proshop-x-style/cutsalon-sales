import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'サロン売上・経費ダッシュボード',
    short_name: 'サロン帳簿',
    description: 'サロン向けの売上・経費管理アプリ',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f7fb',
    theme_color: '#0e7490',
    lang: 'ja',
    icons: [
      {
        src: '/next.svg',
        sizes: '180x180',
        type: 'image/svg+xml',
      },
      {
        src: '/vercel.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
      },
    ],
  };
}
