export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 px-4">
      <div
        role="status"
        onClick={onDismiss}
        className="animate-toast-in cursor-pointer rounded-full bg-fairway-950 px-4 py-2 text-sm font-medium text-cream-50 shadow-lg ring-1 ring-gold-400/30"
      >
        {message}
      </div>
    </div>
  );
}
