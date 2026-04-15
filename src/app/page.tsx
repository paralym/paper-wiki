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

  const [progress, setProgress] = useState({ current: 0, total: 0 });

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError("");
    setProgress({ current: 0, total: 0 });

    try {
      // Step 1: Get metadata
      setStatus("正在获取论文信息...");
      const startRes = await fetch("/api/ingest/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error);
      const { meta } = startData;

      // Step 1.5: Download and parse LaTeX source
      setStatus("正在下载并解析 LaTeX 源码...");
      const parseRes = await fetch("/api/ingest/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arxivId: meta.arxivId }),
      });
      const parseData = await parseRes.json();
      if (!parseRes.ok) throw new Error(parseData.error);

      const { chunks } = parseData;
      const translatableChunks = chunks.filter((c: { translatable: boolean }) => c.translatable);
      setProgress({ current: 0, total: translatableChunks.length });

      // Step 2: Translate chunks in parallel (concurrency = 4)
      const CONCURRENCY = 32;
      const results: (string | null)[] = new Array(chunks.length).fill(null);
      let completed = 0;

      // Fill in non-translatable chunks immediately
      for (let i = 0; i < chunks.length; i++) {
        if (!chunks[i].translatable) {
          results[i] = chunks[i].text;
        }
      }

      // Get indices of translatable chunks
      const translatableIndices = chunks
        .map((c: { translatable: boolean }, i: number) => c.translatable ? i : -1)
        .filter((i: number) => i !== -1);

      setStatus(`开始并行翻译 ${translatableIndices.length} 个文本块...`);

      // Process in batches of CONCURRENCY
      for (let batch = 0; batch < translatableIndices.length; batch += CONCURRENCY) {
        const batchIndices = translatableIndices.slice(batch, batch + CONCURRENCY);
        const promises = batchIndices.map(async (idx: number) => {
          const trRes = await fetch("/api/ingest/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: chunks[idx].text }),
          });
          const trData = await trRes.json();
          if (!trRes.ok) throw new Error(trData.error);
          return { idx, translated: trData.translated };
        });

        const batchResults = await Promise.all(promises);
        for (const { idx, translated } of batchResults) {
          results[idx] = translated;
          completed++;
        }
        setProgress({ current: completed, total: translatableIndices.length });
        setStatus(`正在翻译 (${completed}/${translatableIndices.length})...`);
      }

      const translatedParts = results as string[];

      // Step 3: Save and generate knowledge pages
      setStatus("正在生成知识页面...");
      const finishRes = await fetch("/api/ingest/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta, translatedTex: translatedParts.join("") }),
      });
      const finishData = await finishRes.json();
      if (!finishRes.ok) throw new Error(finishData.error);

      setStatus(`完成: ${finishData.title}`);
      setUrl("");
      fetchPapers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "未知错误";
      setError(message);
      setStatus("");
    } finally {
      setLoading(false);
      setProgress({ current: 0, total: 0 });
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
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {status}
            </div>
            {progress.total > 0 && (
              <div className="w-full bg-border rounded-full h-2">
                <div
                  className="bg-accent h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            )}
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
