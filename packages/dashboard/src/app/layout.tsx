import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Areté AI Code Review",
  description: "Premium AI Code Review Platform",
};

// Root layout stays chrome-free (just the html/body shell) so /login can
// render without the authenticated sidebar. The dashboard sidebar chrome —
// which needs the session — lives in app/(dashboard)/layout.tsx and is only
// mounted for routes inside that group.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} font-sans h-full antialiased dark`}>
      <body className="min-h-full flex text-content-primary selection:bg-indigo-500/30">
        {children}
      </body>
    </html>
  );
}
