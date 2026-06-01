import { useState } from "react";
import { Check, MessageSquare, Pencil, Send, X } from "lucide-react";
import { eqName } from "../lib/format";
import type { Comment } from "../lib/types";

function relativeTime(iso: string): string {
  const dt = Date.parse(iso);
  if (Number.isNaN(dt)) return "";
  const diff = Date.now() - dt;
  if (diff < 60_000) return "just now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(dt).toLocaleDateString();
}

export function Comments({
  comments,
  myName,
  readOnly,
  onPost,
  onEdit,
  onDelete,
}: {
  comments: Comment[];
  myName: string;
  readOnly: boolean;
  onPost: (body: string) => void | Promise<void>;
  onEdit: (commentId: string, body: string) => void | Promise<void>;
  onDelete: (commentId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !myName) return;
    setPosting(true);
    try {
      await onPost(body);
      setDraft("");
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (commentId: string) => {
    const body = editDraft.trim();
    if (!body) return;
    setSavingEdit(true);
    try {
      await onEdit(commentId, body);
      setEditingId(null);
      setEditDraft("");
    } finally {
      setSavingEdit(false);
    }
  };

  // Always show the comments label; expand inline when there's at least one
  // comment OR the user opens it.
  const hasAny = comments.length > 0;

  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-700"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {hasAny
          ? `${comments.length} comment${comments.length === 1 ? "" : "s"}`
          : "Add a comment"}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {comments.length > 0 && (
            <ul className="space-y-1.5">
              {comments.map((c) => {
                const mine = !!myName && eqName(c.author, myName);
                const editing = editingId === c.id;
                return (
                  <li
                    key={c.id}
                    className="group flex items-start justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5 text-xs text-stone-500">
                        <span className="font-medium text-stone-700">
                          {c.author}
                        </span>
                        <span className="text-stone-400">
                          {relativeTime(c.createdAt)}
                          {c.editedAt ? " · edited" : ""}
                        </span>
                      </div>
                      {editing ? (
                        <div className="mt-1 flex items-end gap-1.5">
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            maxLength={500}
                            rows={2}
                            disabled={savingEdit}
                            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-stone-800 focus:border-fairway-600 focus:outline-none focus:ring-2 focus:ring-fairway-100"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                saveEdit(c.id);
                              } else if (e.key === "Escape") {
                                setEditingId(null);
                                setEditDraft("");
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => saveEdit(c.id)}
                            disabled={!editDraft.trim() || savingEdit}
                            aria-label="Save comment"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fairway-600 text-white hover:bg-fairway-700 disabled:bg-stone-200 disabled:text-stone-400"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft("");
                            }}
                            disabled={savingEdit}
                            aria-label="Cancel edit"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-stone-800">
                          {c.body}
                        </p>
                      )}
                    </div>
                    {mine && !readOnly && !editing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(c.id);
                            setEditDraft(c.body);
                          }}
                          aria-label="Edit comment"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-fairway-700"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Delete this comment?")) {
                              onDelete(c.id);
                            }
                          }}
                          aria-label="Delete comment"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-rose-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!readOnly && (
            <form
              onSubmit={submit}
              className="flex items-end gap-2 rounded-lg border border-stone-200 p-1.5 focus-within:border-fairway-600 focus-within:ring-2 focus-within:ring-fairway-100"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={500}
                rows={1}
                placeholder={
                  myName
                    ? "Say something to the group…"
                    : "Add your name first"
                }
                disabled={!myName || posting}
                className="min-h-[2rem] flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(e as unknown as React.FormEvent);
                  }
                }}
              />
              <button
                type="submit"
                disabled={!myName || !draft.trim() || posting}
                aria-label="Post comment"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fairway-600 text-white shadow-sm hover:bg-fairway-700 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
