import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Paper Wiki",
  description: "arXiv 论文中文翻译与个人知识库",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-surface sticky top-0 z-50">
          <nav className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Paper Wiki
            </Link>
            <div className="flex gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-foreground transition-colors">
                首页
              </Link>
              <Link href="/concepts" className="hover:text-foreground transition-colors">
                概念
              </Link>
              <Link href="/entities" className="hover:text-foreground transition-colors">
                实体
              </Link>
            </div>
          </nav>
        </header>
        <main className="flex-1 mx-auto px-4 py-8 w-full max-w-screen-2xl">
          {children}
        </main>
        <footer className="border-t border-border py-4 text-center text-sm text-muted">
          Paper Wiki — arXiv 论文中文翻译与知识库
        </footer>
      </body>
    </html>
  );
}
