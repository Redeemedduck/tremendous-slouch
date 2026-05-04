// ============================================================
// HEADER + NAME PROMPT
// ============================================================
export function Header({
  myName,
  onChangeName,
}: {
  myName: string;
  onChangeName: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-stone-200 bg-stone-50/85 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          DJDI Golf Board
        </h1>
        {myName ? (
          <p className="text-xs text-stone-500">
            You're <span className="font-medium text-stone-700">{myName}</span>
            {" · "}
            <button
              type="button"
              onClick={onChangeName}
              className="text-fairway-700 underline-offset-2 hover:underline"
            >
              change
            </button>
          </p>
        ) : null}
      </div>
    </header>
  );
}
