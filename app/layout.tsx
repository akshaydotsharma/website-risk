import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/ui/sidebar";
import { Header } from "@/components/ui/header";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Website Risk Intel",
  description: "Website intelligence scanner for risk assessment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={cn(inter.className, "antialiased")}>
        <Header />
        <Sidebar />
        <div className="min-h-[calc(100vh-4rem)] flex flex-col pl-16">
          <main className="flex-1 container mx-auto px-4 py-8">{children}</main>
          <footer className="border-t py-6 text-center text-sm text-muted-foreground">
            Website Risk Intel - Scan websites to extract intelligence signals
          </footer>
        </div>
      </body>
    </html>
  );
}
