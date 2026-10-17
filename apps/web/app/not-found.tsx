import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center p-6 text-center">
      <div className="max-w-md w-full border border-[#20242a] bg-[#14171b] p-8 rounded-sm space-y-4">
        <span className="text-xs uppercase tracking-widest text-[#c5a059] font-medium">
          404 &mdash; Page Not Found
        </span>
        <h2 className="font-display text-2xl font-normal text-[#f3f4f6]">
          Resource Unavailable
        </h2>
        <p className="text-sm text-[#9ca3af]">
          The page or gallery link you are attempting to access does not exist or has expired.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-block px-5 py-2 text-xs uppercase tracking-wider font-medium text-[#0a0b0d] bg-[#c5a059] hover:bg-[#d4b26f] transition-colors rounded-sm"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
