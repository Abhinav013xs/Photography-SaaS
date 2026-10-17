'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Structured console logging in client error boundary
    console.error('[Web Error Boundary]', error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center p-6" role="alert">
      <div className="max-w-md w-full border border-[#2c323b] bg-[#14171b] p-8 rounded-sm space-y-4 text-center">
        <span className="text-xs uppercase tracking-widest text-[#e63946] font-medium">
          Application Error
        </span>
        <h2 className="font-display text-2xl font-normal text-[#f3f4f6]">
          An unexpected error occurred
        </h2>
        <p className="text-sm text-[#9ca3af]">
          The application encountered an error while rendering this page.
        </p>
        <div className="pt-2">
          <button
            onClick={() => reset()}
            className="px-5 py-2 text-xs uppercase tracking-wider font-medium text-[#0a0b0d] bg-[#c5a059] hover:bg-[#d4b26f] transition-colors rounded-sm cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}
