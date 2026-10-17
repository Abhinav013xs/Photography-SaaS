export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center p-6" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-[#20242a] border-t-[#c5a059] animate-spin" />
        <span className="text-xs uppercase tracking-widest text-[#9ca3af]">
          Loading Application...
        </span>
      </div>
    </div>
  );
}
