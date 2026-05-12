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
        className="cursor-pointer rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        {message}
      </div>
    </div>
  );
}
