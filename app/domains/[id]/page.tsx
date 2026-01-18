import { redirect } from "next/navigation";

export default async function DomainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Redirect to the scans page which now handles both domain and scan IDs
  redirect(`/scans/${id}`);
}
