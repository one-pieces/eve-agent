import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppNavbar } from "@/app/_components/app-navbar";
import { ElectronTopBar } from "@/app/_components/electron-topbar";
import { LanguageProvider } from "@/app/_context/language-context";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

export const metadata: Metadata = {
  title: "eve-agent",
  description: "A Next.js starter for eve agents with AI Elements.",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html className={cn(sans.variable, mono.variable)} lang="en">
      <body>
        <LanguageProvider>
          <TooltipProvider>
            <div className="flex h-dvh flex-col overflow-hidden">
              <ElectronTopBar />
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <AppNavbar />
                <div className="flex-1 overflow-hidden">{children}</div>
              </div>
            </div>
          </TooltipProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
