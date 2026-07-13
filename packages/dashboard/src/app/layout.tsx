import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Serif display face for the "Marble & Ink" brand — headings and the wordmark.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Areté — AI code review that checks its own work",
  description:
    "Six specialist agents review every pull request in parallel; a Synthesizer verifies each finding against your diff and posts only what it can prove.",
};

// Root layout stays chrome-free (just the html/body shell) so /login can
// render without the authenticated sidebar. The dashboard sidebar chrome —
// which needs the session — lives in app/(dashboard)/layout.tsx and is only
// mounted for routes inside that group.
//
// data-theme="light" locks the Marble & Ink light world as the brand default
// (a future in-app toggle can flip it to "dark"; the dark tokens are defined).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${inter.variable} ${jetbrainsMono.variable} ${newsreader.variable} font-sans h-full antialiased`}
    >
      <body className="min-h-full bg-surface-0 text-content-primary selection:bg-accent-primary/20">
        {children}
      </body>
    </html>
  );
}
