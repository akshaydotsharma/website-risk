import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <Badge variant="success-subtle">Completed</Badge>;
    case "processing":
      return <Badge variant="info-subtle">Processing\u2026</Badge>;
    case "failed":
      return <Badge variant="danger-subtle">Failed</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
}
