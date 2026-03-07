"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

export function RunNameCell({
  runId,
  initialName,
}: {
  runId: string;
  initialName: string | null;
}) {
  const [name, setName] = useState(initialName || "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName = name || "Untitled run";

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraft(name || "");
    setEditing(true);
  };

  const save = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const trimmed = draft.trim();
    try {
      await fetch(`/api/about-analysis/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      setName(trimmed);
    } catch {
      // silently fail
    }
    setEditing(false);
  };

  const cancel = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  if (editing) {
    return (
      <span
        className="inline-flex items-center gap-1"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Run name"
          className="text-sm font-medium bg-transparent border-b border-primary outline-none px-0 py-0 min-w-[100px] max-w-[200px]"
        />
        <button
          onClick={save}
          className="p-0.5 rounded text-primary hover:bg-primary/10 transition-colors"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={cancel}
          className="p-0.5 rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 group/name">
      <span className="text-sm font-medium text-foreground truncate">
        {displayName}
      </span>
      <button
        onClick={startEditing}
        className="p-0.5 rounded text-muted-foreground opacity-0 group-hover/name:opacity-100 hover:bg-muted hover:text-foreground transition-all"
        aria-label="Rename"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </span>
  );
}
