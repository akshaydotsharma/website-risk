"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

export function EditableName({
  runId,
  initialName,
  fallback,
}: {
  runId: string;
  initialName: string | null;
  fallback: string;
}) {
  const [name, setName] = useState(initialName || "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName = name || fallback;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(name || "");
    setEditing(true);
  };

  const save = async () => {
    const trimmed = draft.trim();
    try {
      await fetch(`/api/about-analysis/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      setName(trimmed);
    } catch {
      // silently fail, keep old name
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={fallback}
          className="text-lg font-semibold bg-transparent border-b-2 border-primary outline-none px-0 py-0 min-w-[120px]"
        />
        <button
          onClick={save}
          className="p-1 rounded-md text-primary hover:bg-primary/10 transition-colors"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          onClick={cancel}
          className="p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      <h1 className="text-lg font-semibold">{displayName}</h1>
      <button
        onClick={startEditing}
        className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-all"
        title="Rename"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
