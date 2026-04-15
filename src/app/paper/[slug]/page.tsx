"use client";

import { useState, useEffect, use, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const LatexRenderer = lazy(() => import("@/components/LatexRenderer"));

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
  content: string;
}

export default function PaperPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [paper, setPaper] = useState<PaperResponse | null>(null);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<'side-by-side' | 'translated' | 'original'>('side-by-side');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/papers/${slug}`)
      .then(res => { if (!res.ok) throw new Error("论文未找到"); return res.json(); })
      .then(setPaper)
      .catch(e => setError(e.message));
  }, [slug]);

  async function handleDelete() {
    if (!confirm("确定删除这篇论文及其关联的概念/实体？")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/papers/${slug}/delete`, { method: "POST" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "删除失败");
      setDeleting(false);
    }
  }

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
  const arxivId = data.arxiv_id;

  return (
    <article className="w-full">
      {/* Header */}
      <header className="mb-4 max-w-4xl">
        <h1 className="text-2xl font-bold mb-1">{data.title}</h1>
        {data.title_en && <p className="text-muted mb-2">{data.title_en}</p>}
        <div className="flex flex-wrap gap-3 text-sm text-muted mb-2">
          <a href={`https://arxiv.org/abs/${arxivId}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            arXiv:{arxivId}
          </a>
          <span>{data.date}</span>
          <span>{data.authors?.slice(0, 3).join(", ")}{(data.authors?.length ?? 0) > 3 ? " ..." : ""}</span>
        </div>
        {data.summary && (
          <div className="bg-accent-light border border-border rounded-lg p-3 text-sm mb-3">
            <strong>摘要: </strong>{data.summary}
          </div>
        )}
        <div className="flex gap-1 bg-border rounded-lg p-1 w-fit">
          {(['side-by-side', 'translated', 'original'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === mode ? 'bg-surface text-foreground font-medium shadow-sm' : 'text-muted hover:text-foreground'
              }`}
            >
              {mode === 'side-by-side' ? '双栏对照' : mode === 'translated' ? '中文译文' : '英文原文'}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div
        className={viewMode === 'side-by-side' ? 'grid grid-cols-2 gap-4' : ''}
        style={{ height: 'calc(100vh - 280px)' }}
      >
        {/* Original — iframe */}
        {(viewMode === 'original' || viewMode === 'side-by-side') && (
          <div className="border border-border rounded-lg overflow-hidden h-full">
            {viewMode === 'side-by-side' && (
              <div className="text-xs text-muted px-4 py-2 bg-surface border-b border-border font-medium uppercase tracking-wide">
                原文 Original
                <a href={`https://arxiv.org/html/${arxivId}`} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent">↗</a>
              </div>
            )}
            <iframe
              src={`https://arxiv.org/html/${arxivId}`}
              className="w-full h-full border-0"
              sandbox="allow-same-origin allow-scripts"
              title="Original paper"
            />
          </div>
        )}

        {/* Translation — LaTeX rendered */}
        {(viewMode === 'translated' || viewMode === 'side-by-side') && (
          <div className="border border-border rounded-lg overflow-auto h-full">
            {viewMode === 'side-by-side' && (
              <div className="text-xs text-muted px-4 py-2 bg-surface border-b border-border font-medium uppercase tracking-wide sticky top-0 z-10">
                译文 Translation
              </div>
            )}
            <div className="p-6">
              <Suspense fallback={<div className="text-muted">正在渲染 LaTeX...</div>}>
                <LatexRenderer latex={paper.content} />
              </Suspense>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-border flex justify-between items-center max-w-4xl">
        <Link href="/" className="text-accent hover:underline text-sm">← 返回论文列表</Link>
        <div className="flex gap-3">
          <a
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(paper.content)}`}
            download={`${slug}-zh.tex`}
            className="px-4 py-1.5 text-sm text-accent border border-accent rounded-lg hover:bg-accent-light transition-colors"
          >
            下载 .tex
          </a>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-1.5 text-sm text-red-500 border border-red-300 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
          >
            {deleting ? "删除中..." : "删除论文"}
          </button>
        </div>
      </div>
    </article>
  );
}
