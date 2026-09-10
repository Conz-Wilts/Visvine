import { Suspense } from 'react';
import DiscoverPage from '@/features/discover/components/DiscoverPage';

// The view rides the URL (useSearchParams), so the page renders under Suspense.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <DiscoverPage />
    </Suspense>
  );
}
