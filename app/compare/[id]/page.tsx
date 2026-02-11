import { notFound } from "next/navigation";
import Link from "next/link";
import { getComparison } from "@/lib/compare";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getScoreTextColor,
  getScoreBgColor,
  getConfidenceColor,
} from "@/lib/utils";
import {
  GitCompare,
  FileText,
  Code,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ExternalLink,
  ChevronLeft,
  Info,
  Plus,
} from "lucide-react";

export const dynamic = "force-dynamic";

function getSimilarityLabel(score: number): string {
  if (score >= 90) return "Nearly Identical";
  if (score >= 70) return "Very Similar";
  if (score >= 50) return "Moderately Similar";
  if (score >= 30) return "Somewhat Similar";
  return "Different";
}

// Invert colors for similarity (high = good/green, low = red)
function getSimilarityTextColor(score: number): string {
  if (score >= 70) return "text-success";
  if (score >= 50) return "text-warning";
  if (score >= 30) return "text-caution";
  return "text-muted-foreground";
}

function getSimilarityBgColor(score: number): string {
  if (score >= 70) return "bg-success";
  if (score >= 50) return "bg-warning";
  if (score >= 30) return "bg-caution";
  return "bg-muted-foreground";
}

export default async function CompareResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const isExisting = search.existing === "true";

  const result = await getComparison(id);

  if (!result) {
    notFound();
  }

  const { overallScore, textScore, domScore, confidence, reasons, featureDiff } =
    result;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Existing comparison notice */}
      {isExisting && (
        <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-900 dark:text-blue-100">
            This comparison already exists. Showing the previous result for these URLs.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/compare/history"
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Back to history"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <GitCompare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Comparison Results</h1>
              <p className="text-sm text-muted-foreground">
                {result.artifactA.domain} vs {result.artifactB.domain}
              </p>
            </div>
          </div>
        </div>
        <Button asChild>
          <Link href="/compare">
            <Plus className="h-4 w-4 mr-2" />
            New Comparison
          </Link>
        </Button>
      </div>

      {/* Overall Score Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <div className="text-center min-w-[100px]">
              <div
                className={`text-5xl font-bold ${getSimilarityTextColor(overallScore)}`}
              >
                {overallScore}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {getSimilarityLabel(overallScore)}
              </div>
            </div>
            <div className="flex-1">
              <div className="h-4 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getSimilarityBgColor(overallScore)} transition-all`}
                  style={{ width: `${overallScore}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>0 - Different</span>
                <span>100 - Identical</span>
              </div>
            </div>
          </div>

          {/* Confidence */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Confidence:</span>
              <span
                className={`text-sm font-bold ${getConfidenceColor(confidence)}`}
              >
                {confidence}%
              </span>
            </div>
            {confidence < 50 && (
              <Badge variant="outline" className="text-caution border-caution/30">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Low confidence
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Component Scores */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
              <FileText className="h-4 w-4" />
              Text Similarity
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`text-3xl font-bold ${getSimilarityTextColor(textScore)}`}
              >
                {textScore}
              </div>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getSimilarityBgColor(textScore)}`}
                  style={{ width: `${textScore}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Semantic similarity of homepage text content
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
              <Code className="h-4 w-4" />
              DOM Similarity
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`text-3xl font-bold ${getSimilarityTextColor(domScore)}`}
              >
                {domScore}
              </div>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getSimilarityBgColor(domScore)}`}
                  style={{ width: `${domScore}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              HTML structure and element distribution
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reasons */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            Analysis Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {reasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground mt-0.5">•</span>
                {reason}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Side-by-Side Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Page Statistics</CardTitle>
          <CardDescription>
            Side-by-side comparison of extracted features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Metric</TableHead>
                  <TableHead>
                    <a
                      href={featureDiff?.statsA?.finalUrl || result.urlA}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link hover:underline flex items-center gap-1"
                    >
                      Site A
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableHead>
                  <TableHead>
                    <a
                      href={featureDiff?.statsB?.finalUrl || result.urlB}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-link hover:underline flex items-center gap-1"
                    >
                      Site B
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Domain</TableCell>
                  <TableCell>{result.artifactA.domain}</TableCell>
                  <TableCell>{result.artifactB.domain}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Status</TableCell>
                  <TableCell>
                    {result.artifactA.ok ? (
                      <Badge variant="success" className="text-xs">
                        {result.artifactA.statusCode || "OK"}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs">
                        Failed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {result.artifactB.ok ? (
                      <Badge variant="success" className="text-xs">
                        {result.artifactB.statusCode || "OK"}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs">
                        Failed
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Word Count</TableCell>
                  <TableCell>
                    {featureDiff?.statsA?.wordCount?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell>
                    {featureDiff?.statsB?.wordCount?.toLocaleString() || "-"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">H1 / H2 Count</TableCell>
                  <TableCell>
                    {featureDiff?.statsA?.h1Count ?? "-"} /{" "}
                    {featureDiff?.statsA?.h2Count ?? "-"}
                  </TableCell>
                  <TableCell>
                    {featureDiff?.statsB?.h1Count ?? "-"} /{" "}
                    {featureDiff?.statsB?.h2Count ?? "-"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Link Count</TableCell>
                  <TableCell>
                    {featureDiff?.statsA?.linkCount?.toLocaleString() || "-"}
                  </TableCell>
                  <TableCell>
                    {featureDiff?.statsB?.linkCount?.toLocaleString() || "-"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Button Count</TableCell>
                  <TableCell>
                    {featureDiff?.statsA?.buttonCount ?? "-"}
                  </TableCell>
                  <TableCell>
                    {featureDiff?.statsB?.buttonCount ?? "-"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Form Count</TableCell>
                  <TableCell>
                    {featureDiff?.statsA?.formCount ?? "-"}
                  </TableCell>
                  <TableCell>
                    {featureDiff?.statsB?.formCount ?? "-"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Password Inputs</TableCell>
                  <TableCell>
                    {featureDiff?.statsA?.passwordInputCount ?? "-"}
                  </TableCell>
                  <TableCell>
                    {featureDiff?.statsB?.passwordInputCount ?? "-"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Blocked</TableCell>
                  <TableCell>
                    {featureDiff?.statsA?.blocked ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-success" />
                    )}
                  </TableCell>
                  <TableCell>
                    {featureDiff?.statsB?.blocked ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-success" />
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Common Headings */}
      {featureDiff?.commonHeadings && featureDiff.commonHeadings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Shared Headings</CardTitle>
            <CardDescription>
              Headings found on both pages (overlap:{" "}
              {Math.round((featureDiff.headingOverlap || 0) * 100)}%)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {featureDiff.commonHeadings.slice(0, 10).map((heading, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {heading}
                </Badge>
              ))}
              {featureDiff.commonHeadings.length > 10 && (
                <Badge variant="outline" className="text-xs">
                  +{featureDiff.commonHeadings.length - 10} more
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Debug Accordion */}
      <Accordion>
        <AccordionItem title="Debug: Features JSON (Site A)">
          <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
            {JSON.stringify(result.artifactA.features, null, 2)}
          </pre>
        </AccordionItem>
        <AccordionItem title="Debug: Features JSON (Site B)">
          <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
            {JSON.stringify(result.artifactB.features, null, 2)}
          </pre>
        </AccordionItem>
        <AccordionItem title="Debug: Feature Diff">
          <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
            {JSON.stringify(featureDiff, null, 2)}
          </pre>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
