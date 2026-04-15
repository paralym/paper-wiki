"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface PaperResponse {
  data: {
    title: string;
    title_en?: string;
    arxiv_id: string;
    authors: string[];
    date: string;
    categories: string[];
    concepts: string[];
    entities: string[];
    summary: string;
  };
  mode: 'html' | 'markdown';
  originalHtml?: string;
  translatedHtml?: string;
  html?: string;
}

export default function PaperPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [paper, setPaper] = useState<PaperResponse | null>(null);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<'translated' | 'original' | 'side-by-side'>('side-by-side');
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("确定删除这篇论文及其关联的概念/实体？")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/papers/${slug}/delete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "删除失败";
      setError(msg);
      setDeleting(false);
    }
  }

  useEffect(() => {
    fetch(`/api/papers/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error("论文未找到");
        return res.json();
      })
      .then(setPaper)
      .catch((e) => setError(e.message));
  }, [slug]);

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">{error}</p>
        <Link href="/" className="text-accent hover:underline">返回首页</Link>
      </div>
    );
  }

  if (!paper) {
    return <div className="text-center py-12 text-muted">加载中...</div>;
  }

  const { data } = paper;
  const isHtmlMode = paper.mode === 'html';

  return (
    <article className={isHtmlMode && viewMode === 'side-by-side' ? 'w-full' : 'max-w-4xl mx-auto'}>
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-2">{data.title}</h1>
        {data.title_en && (
          <p className="text-muted mb-3">{data.title_en}</p>
        )}
        <div className="flex flex-wrap gap-3 text-sm text-muted mb-3">
          <a
            href={`https://arxiv.org/abs/${data.arxiv_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            arXiv:{data.arxiv_id}
          </a>
          <span>{data.date}</span>
          <span>{data.authors?.slice(0, 3).join(", ")}{(data.authors?.length ?? 0) > 3 ? " ..." : ""}</span>
        </div>
        {data.summary && (
          <div className="bg-accent-light border border-border rounded-lg p-3 text-sm mb-3">
            <strong>摘要: </strong>{data.summary}
          </div>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {data.categories?.map((cat) => (
            <span key={cat} className="px-2 py-0.5 bg-accent-light text-accent text-xs rounded">{cat}</span>
          ))}
          {data.concepts?.map((c) => (
            <Link key={c} href={`/concept/${c.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
              className="px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs rounded hover:opacity-80"
            >{c}</Link>
          ))}
        </div>

        {/* View mode toggle */}
        {isHtmlMode && (
          <div className="flex gap-1 bg-border rounded-lg p-1 w-fit">
            {(['side-by-side', 'translated', 'original'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  viewMode === mode
                    ? 'bg-surface text-foreground font-medium shadow-sm'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {mode === 'side-by-side' ? '双栏对照' : mode === 'translated' ? '中文译文' : '英文原文'}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Content */}
      {isHtmlMode ? (
        <>
          {/* Load arxiv LaTeXML CSS */}
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/niclasberg/ar5iv-css@main/ar5iv.min.css" />
          <div className={viewMode === 'side-by-side' ? 'grid grid-cols-2 gap-6' : ''}>
            {(viewMode === 'original' || viewMode === 'side-by-side') && (
              <div className="border border-border rounded-lg p-6 overflow-auto max-h-[85vh] overflow-y-auto">
                {viewMode === 'side-by-side' && (
                  <div className="text-xs text-muted mb-3 font-medium uppercase tracking-wide sticky top-0 bg-surface py-1">原文 Original</div>
                )}
                <div
                  className="arxiv-content"
                  dangerouslySetInnerHTML={{ __html: paper.originalHtml || '' }}
                />
              </div>
            )}
            {(viewMode === 'translated' || viewMode === 'side-by-side') && (
              <div className="border border-border rounded-lg p-6 overflow-auto max-h-[85vh] overflow-y-auto">
                {viewMode === 'side-by-side' && (
                  <div className="text-xs text-muted mb-3 font-medium uppercase tracking-wide sticky top-0 bg-surface py-1">译文 Translation</div>
                )}
                <div
                  className="arxiv-content"
                  dangerouslySetInnerHTML={{ __html: paper.translatedHtml || '' }}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          className="paper-content"
          dangerouslySetInnerHTML={{ __html: paper.html || '' }}
        />
      )}

      {/* Footer */}
      <div className="mt-12 pt-6 border-t border-border flex justify-between items-center">
        <Link href="/" className="text-accent hover:underline text-sm">
          ← 返回论文列表
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-4 py-1.5 text-sm text-red-500 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
        >
          {deleting ? "删除中..." : "删除论文"}
        </button>
      </div>
    </article>
  );
}
