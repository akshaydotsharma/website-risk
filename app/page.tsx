import { Suspense } from "react";
import HomePageContent from "./home-content";

export default function HomePage() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomePageContent />
    </Suspense>
  );
}

function HomePageSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Website Risk Intel</h1>
        <p className="text-muted-foreground">
          Scan websites to extract intelligence signals for risk assessment
        </p>
      </div>
      <div className="h-64 bg-muted/50 rounded-lg animate-pulse" />
    </div>
  );
}
