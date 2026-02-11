"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { RotateCw, Loader2, ClipboardCheck, X, AlertTriangle } from "lucide-react";

interface RescanButtonProps {
  scanId: string;
  domainId?: string;
  isManuallyRisky?: boolean;
  initialScanStatus?: string | null;
  initialScanCreatedAt?: string | null;
}

export function RescanButton({ scanId, domainId, isManuallyRisky = false, initialScanStatus, initialScanCreatedAt }: RescanButtonProps) {
  const [isRescanning, setIsRescanning] = useState(false);
  const [isScanInProgress, setIsScanInProgress] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [isRisky, setIsRisky] = useState(isManuallyRisky);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  const closeModal = useCallback(() => {
    setShowReviewModal(false);
    setReviewNote("");
    // Reset to current risk state, not false
    setIsRisky(isManuallyRisky);
  }, [isManuallyRisky]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Detect if a scan is already in progress (client-side only to avoid hydration mismatch)
  useEffect(() => {
    if (!initialScanStatus || initialScanStatus === "completed" || initialScanStatus === "failed") {
      setIsScanInProgress(false);
      return;
    }
    if (!initialScanCreatedAt) {
      setIsScanInProgress(false);
      return;
    }
    const scanAge = Date.now() - new Date(initialScanCreatedAt).getTime();
    const fiveMinutes = 5 * 60 * 1000;
    setIsScanInProgress(
      (initialScanStatus === "pending" || initialScanStatus === "processing") && scanAge < fiveMinutes
    );
  }, [initialScanStatus, initialScanCreatedAt]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!showReviewModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showReviewModal, closeModal]);

  const handleRescan = async () => {
    setIsRescanning(true);

    try {
      const response = await fetch(`/api/scans/${scanId}/rescan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error("Failed to rescan");
      }

      router.refresh();
    } catch (error) {
      console.error("Rescan error:", error);
      alert("Failed to rescan. Please try again.");
    } finally {
      setIsRescanning(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!domainId) return;

    setIsSubmittingReview(true);

    try {
      const response = await fetch(`/api/domains/${domainId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "review",
          riskDecision: isRisky ? "risky" : "not_risky",
          content: reviewNote.trim() || undefined,
        }),
      });

      if (response.ok) {
        closeModal();
        router.refresh();
      } else {
        throw new Error("Failed to submit review");
      }
    } catch (error) {
      console.error("Failed to submit review:", error);
      alert("Failed to submit review. Please try again.");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ overscrollBehavior: "contain" }}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeModal}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-modal-title"
        className="relative bg-background border rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 id="review-modal-title" className="text-lg font-semibold">Submit Review</h2>
          <button
            onClick={closeModal}
            aria-label="Close modal"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-5">
          {/* Mark as Risky */}
          <label
            htmlFor="mark-risky"
            className="flex items-center justify-between py-2 cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${isRisky ? "text-red-500" : "text-muted-foreground/50"}`} />
              <span className="text-sm font-medium select-none">Mark as Risky</span>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                id="mark-risky"
                checked={isRisky}
                onChange={(e) => setIsRisky(e.target.checked)}
                className="peer sr-only"
              />
              <div
                className={`
                  w-9 h-5 rounded-full transition-colors duration-200
                  ${isRisky ? "bg-red-500" : "bg-muted-foreground/20"}
                  peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2
                `}
              >
                <div
                  className={`
                    absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200
                    ${isRisky ? "translate-x-[18px]" : "translate-x-0.5"}
                  `}
                />
              </div>
            </div>
          </label>

          {/* Note */}
          <div className="space-y-2">
            <label htmlFor="review-note" className="text-sm font-medium">
              Note <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <textarea
              id="review-note"
              name="reviewNote"
              placeholder="Add any observations or reasoning…"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              className="
                w-full min-h-[100px] p-3 rounded-lg
                border bg-background
                text-sm leading-relaxed resize-y
                placeholder:text-muted-foreground/60
                focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
                transition-shadow
              "
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t bg-muted/30 rounded-b-xl">
          <Button variant="ghost" size="sm" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmitReview}
            disabled={isSubmittingReview}
            size="sm"
          >
            {isSubmittingReview ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Submit Review
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex items-center gap-2">
        {domainId && (
          <div className="flex items-center gap-1.5">
            {isManuallyRisky && (
              <div className="relative group">
                <div className="p-1.5 rounded-md text-amber-500 cursor-help">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  Marked as risky by reviewer
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
              </div>
            )}
            <Button
              onClick={() => {
                setIsRisky(isManuallyRisky);
                setShowReviewModal(true);
              }}
              variant="outline"
              size="sm"
            >
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Review
            </Button>
          </div>
        )}
        <Button
          onClick={handleRescan}
          disabled={isRescanning || isScanInProgress}
          variant="outline"
          size="sm"
        >
          {isRescanning || isScanInProgress ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isRescanning ? "Rescanning…" : "Scanning…"}
            </>
          ) : (
            <>
              <RotateCw className="mr-2 h-4 w-4" />
              Rescan
            </>
          )}
        </Button>
      </div>

      {/* Render modal using portal to avoid z-index issues */}
      {mounted && showReviewModal && createPortal(modalContent, document.body)}
    </>
  );
}
