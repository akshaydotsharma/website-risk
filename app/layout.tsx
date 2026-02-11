import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/ui/sidebar";
import { Header } from "@/components/ui/header";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

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
    <html lang="en" className={inter.variable}>
      <body className={cn(inter.className, "antialiased min-h-screen bg-background")}>
        <Header />
        <Sidebar />
        <div className="min-h-[calc(100vh-4rem)] flex flex-col pl-16">
          <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {children}
          </main>
          <footer className="border-t bg-card/50 py-5 text-center text-xs text-muted-foreground">
            <span className="opacity-70">&copy; {new Date().getFullYear()} Website Risk Intel</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
