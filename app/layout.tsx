import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/ui/sidebar";
import { Header } from "@/components/ui/header";
import { MainContent } from "@/components/ui/main-content";
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
          <MainContent>{children}</MainContent>
        </Providers>
      </body>
    </html>
  );
}
