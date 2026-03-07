import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/ui/sidebar";
import { Header } from "@/components/ui/header";
import { Providers } from "@/components/providers";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Waldo",
  description: "Find risky websites before they find you",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={cn(inter.className, "antialiased min-h-screen bg-background")}>
        <Providers>
          <Header />
          <Sidebar />
          <div className="min-h-[calc(100vh-4rem)] flex flex-col md:pl-16">
            <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 sm:py-8">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
