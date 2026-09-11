import { Suspense } from 'react';
import { TaxShareClient } from './TaxShareClient';

function LoadingFallback() {
  return (
    <main className="page-surface min-h-screen px-4 py-8 text-stone-800">
      <div className="mx-auto max-w-4xl rounded-2xl border border-stone-200 bg-white p-6">
        <p className="text-base font-semibold text-stone-600">提出用データを読み込み中です...</p>
      </div>
    </main>
  );
}

export default function TaxSharePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <TaxShareClient />
    </Suspense>
  );
}
