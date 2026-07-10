import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Areté AI Code Review",
  description: "Premium AI Code Review Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} font-sans h-full antialiased dark`}>
      <body className="min-h-full flex text-slate-100 selection:bg-indigo-500/30">
        {/* Sidebar */}
        <aside className="w-64 glass border-r border-slate-800/50 flex flex-col fixed h-full z-20">
          <div className="p-6">
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight">
              Areté AI
            </h1>
          </div>
          <nav className="flex-1 px-4 space-y-1.5 mt-2">
            <Link
              href="/"
              className="flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 bg-white/5 text-white border border-white/10 shadow-sm"
            >
              Overview
            </Link>
            <Link
              href="/history"
              className="flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 hover:bg-white/5 hover:text-white text-slate-400"
            >
              Review History
            </Link>
            <Link
              href="/settings"
              className="flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 hover:bg-white/5 hover:text-white text-slate-400"
            >
              Settings
            </Link>
          </nav>
          <div className="p-4 border-t border-slate-800/50">
            <div className="flex items-center gap-3 px-2 py-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold shadow-lg ring-2 ring-indigo-500/20">
                U
              </div>
              <div className="text-sm">
                <p className="font-medium text-slate-200">User Account</p>
                <p className="text-xs text-indigo-300 font-medium">Pro Plan</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 ml-64 p-8 min-h-screen relative overflow-hidden">
          {/* Subtle background glow effect */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
          <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
          {children}
        </main>
      </body>
    </html>
  );
}
