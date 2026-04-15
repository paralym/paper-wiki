"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Paper {
  slug: string;
  data: {
    title: string;
    title_en?: string;
    arxiv_id: string;
    authors: string[];
    date: string;
    categories: string[];
    summary: string;
  };
}

export default function Home() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchPapers();
  }, []);

  async function fetchPapers() {
    try {
      const res = await fetch("/api/papers");
      const data = await res.json();
      setPapers(data);
    } catch {
      // empty wiki
    }
  }

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError("");
    setStatus("正在下载 LaTeX 源码...");

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "翻译失败");
      }

      setStatus(`翻译完成: ${data.title}`);
      setUrl("");
      fetchPapers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "未知错误";
      setError(message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Ingest form */}
      <section className="bg-surface border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">添加论文</h2>
        <form onSubmit={handleIngest} className="flex gap-3">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="输入 arXiv 链接，如 https://arxiv.org/abs/2401.12345"
            className="flex-1 px-4 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="px-6 py-2 bg-accent text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? "翻译中..." : "翻译"}
          </button>
        </form>
        {status && (
          <p className="mt-3 text-sm text-accent">{status}</p>
        )}
        {error && (
          <p className="mt-3 text-sm text-red-500">{error}</p>
        )}
        {loading && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            正在处理，可能需要 1-3 分钟...
          </div>
        )}
      </section>

      {/* Papers list */}
      <section>
        <h2 className="text-xl font-semibold mb-4">
          论文库 {papers.length > 0 && <span className="text-muted font-normal text-base">({papers.length})</span>}
        </h2>
        {papers.length === 0 ? (
          <div className="text-center py-12 text-muted">
            <p className="text-lg mb-2">还没有论文</p>
            <p className="text-sm">在上方输入 arXiv 链接开始翻译</p>
          </div>
        ) : (
          <div className="space-y-3">
            {papers.map((paper) => (
              <Link
                key={paper.slug}
                href={`/paper/${paper.slug}`}
                className="block bg-surface border border-border rounded-lg p-4 hover:border-accent transition-colors"
              >
                <h3 className="font-medium mb-1">{paper.data.title}</h3>
                {paper.data.title_en && (
                  <p className="text-sm text-muted mb-2">{paper.data.title_en}</p>
                )}
                <div className="flex flex-wrap gap-2 text-xs text-muted">
                  <span>{paper.data.arxiv_id}</span>
                  <span>{paper.data.date}</span>
                  <span>{paper.data.authors?.slice(0, 3).join(", ")}{(paper.data.authors?.length ?? 0) > 3 ? " ..." : ""}</span>
                </div>
                {paper.data.summary && (
                  <p className="mt-2 text-sm text-muted line-clamp-2">{paper.data.summary}</p>
                )}
                {paper.data.categories && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {paper.data.categories.slice(0, 5).map((cat) => (
                      <span key={cat} className="px-2 py-0.5 bg-accent-light text-accent text-xs rounded">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
