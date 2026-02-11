"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Check,
  X,
  ShieldAlert,
  ShieldCheck,
  ClipboardCheck,
} from "lucide-react";
import { format } from "date-fns";

interface InvestigationNote {
  id: string;
  content: string;
  type: string; // "note" or "review"
  riskDecision?: string | null; // "risky" or "not_risky"
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface InvestigationNotesProps {
  domainId: string;
  initialNotes?: InvestigationNote[];
}

export function InvestigationNotes({
  domainId,
  initialNotes = [],
}: InvestigationNotesProps) {
  const [notes, setNotes] = useState<InvestigationNote[]>(initialNotes);
  const [newNote, setNewNote] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setIsAdding(true);

    try {
      const response = await fetch(`/api/domains/${domainId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote, type: "note" }),
      });

      if (response.ok) {
        const data = await response.json();
        setNotes([data.note, ...notes]);
        setNewNote("");
        setShowAddForm(false);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to add note:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const handleUpdateNote = async (noteId: string) => {
    if (!editContent.trim()) return;
    setIsUpdating(true);

    try {
      const response = await fetch(
        `/api/domains/${domainId}/notes/${noteId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editContent }),
        }
      );

      if (response.ok) {
        setNotes(
          notes.map((n) =>
            n.id === noteId
              ? { ...n, content: editContent, updatedAt: new Date().toISOString() }
              : n
          )
        );
        setEditingId(null);
        setEditContent("");
      }
    } catch (error) {
      console.error("Failed to update note:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setDeletingId(noteId);

    try {
      const response = await fetch(
        `/api/domains/${domainId}/notes/${noteId}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        setNotes(notes.filter((n) => n.id !== noteId));
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to delete note:", error);
    } finally {
      setDeletingId(null);
    }
  };

  // Separate reviews from regular notes
  const reviews = notes.filter((n) => n.type === "review");
  const regularNotes = notes.filter((n) => n.type === "note");

  return (
    <Card>
      <CardHeader tint="warning">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-600" />
              Investigation Notes
            </CardTitle>
            <CardDescription>
              Document your observations and findings
            </CardDescription>
          </div>
          {!showAddForm && (
            <Button
              onClick={() => setShowAddForm(true)}
              size="sm"
              variant="outline"
              className="border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Note
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Add Note Form */}
        {showAddForm && (
          <div
            className="mb-6 animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <textarea
              placeholder="What did you find?"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              className="
                w-full min-h-[120px] p-4 rounded-xl
                border border-amber-500/20 bg-amber-500/5
                text-sm leading-relaxed resize-y
                placeholder:text-muted-foreground/60
                focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40
                transition-all duration-200
              "
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setNewNote("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddNote}
                disabled={isAdding || !newNote.trim()}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Check className="h-4 w-4 mr-1.5" />
                )}
                Save Note
              </Button>
            </div>
          </div>
        )}

        {/* Reviews Section */}
        {reviews.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" />
              Review History
            </h3>
            <div className="space-y-3">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className={`
                    rounded-xl border p-4 transition-all
                    ${review.riskDecision === "risky"
                      ? "bg-red-500/5 border-red-500/20"
                      : "bg-green-500/5 border-green-500/20"
                    }
                  `}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {review.riskDecision === "risky" ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 text-sm font-medium">
                          <ShieldAlert className="h-4 w-4" />
                          Marked as Risky
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 text-sm font-medium">
                          <ShieldCheck className="h-4 w-4" />
                          Marked as Not Risky
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(review.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                      <button
                        onClick={() => handleDeleteNote(review.id)}
                        disabled={deletingId === review.id}
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 ml-2"
                      >
                        {deletingId === review.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  {review.content && (
                    <p className="text-sm text-foreground/80 mt-3 pl-1">
                      {review.content}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Regular Notes Section */}
        {regularNotes.length > 0 && (
          <div className="space-y-3">
            {reviews.length > 0 && (
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2 pt-2">
                <FileText className="h-4 w-4" />
                Notes
              </h3>
            )}
            <div className="space-y-4">
              {regularNotes.map((note, index) => (
                <div
                  key={note.id}
                  className="group relative"
                  style={{
                    animationDelay: `${index * 50}ms`,
                  }}
                >
                  {editingId === note.id ? (
                    <div className="animate-in fade-in duration-150">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="
                          w-full min-h-[100px] p-4 rounded-xl
                          border border-primary/20 bg-primary/5
                          text-sm leading-relaxed resize-y
                          focus:outline-none focus:ring-2 focus:ring-primary/30
                          transition-all duration-200
                        "
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingId(null);
                            setEditContent("");
                          }}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                        <Button
                          onClick={() => handleUpdateNote(note.id)}
                          disabled={isUpdating || !editContent.trim()}
                          size="sm"
                        >
                          {isUpdating ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                          ) : (
                            <Check className="h-4 w-4 mr-1" />
                          )}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-sm hover:border-border/80">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                        {note.content}
                      </p>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          {note.updatedAt !== note.createdAt && (
                            <span className="text-muted-foreground/50"> · edited</span>
                          )}
                        </span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={() => {
                              setEditingId(note.id);
                              setEditContent(note.content);
                            }}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            disabled={deletingId === note.id}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            {deletingId === note.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {notes.length === 0 && !showAddForm && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted/50 mb-4">
              <FileText className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground font-medium">No notes yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Add notes to keep track of your investigation
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
