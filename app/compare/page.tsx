import { GitCompare } from "lucide-react";
import { CompareForm } from "./compare-form";

export default function ComparePage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Hero Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 py-4">
        <div className="space-y-3">
          <h1 className="text-page-title">Homepage Similarity Compare</h1>
          <p className="text-page-subtitle max-w-lg">
            Compare two websites to detect clones, copycats, or measure content
            similarity using text embeddings and DOM structure analysis.
          </p>
        </div>
        <div className="hidden lg:flex items-center justify-center w-32 h-32 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/10">
          <GitCompare className="w-16 h-16 text-primary/60" />
        </div>
      </div>

      <CompareForm />

      {/* Info Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="p-4 rounded-lg bg-muted/50 border">
          <h3 className="font-medium mb-1">Text Similarity</h3>
          <p className="text-muted-foreground">
            Uses TF-IDF vectorization to measure semantic similarity of page
            content.
          </p>
        </div>
        <div className="p-4 rounded-lg bg-muted/50 border">
          <h3 className="font-medium mb-1">DOM Structure</h3>
          <p className="text-muted-foreground">
            Compares HTML element distribution, layout patterns, and heading
            structure.
          </p>
        </div>
        <div className="p-4 rounded-lg bg-muted/50 border">
          <h3 className="font-medium mb-1">Confidence Score</h3>
          <p className="text-muted-foreground">
            Indicates data quality - lower if pages are blocked or have minimal
            content.
          </p>
        </div>
      </div>
    </div>
  );
}
