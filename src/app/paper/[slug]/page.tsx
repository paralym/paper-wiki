"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

interface PaperData {
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
  html: string;
  content: string;
}

export default function PaperPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [paper, setPaper] = useState<PaperData | null>(null);
  const [error, setError] = useState("");

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

  return (
    <article className="max-w-3xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold mb-2">{data.title}</h1>
        {data.title_en && (
          <p className="text-muted mb-4">{data.title_en}</p>
        )}
        <div className="flex flex-wrap gap-3 text-sm text-muted mb-4">
          <a
            href={`https://arxiv.org/abs/${data.arxiv_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            arXiv:{data.arxiv_id}
          </a>
          <span>{data.date}</span>
        </div>
        <div className="text-sm mb-4">
          <span className="text-muted">作者: </span>
          {data.authors?.join(", ")}
        </div>
        {data.summary && (
          <div className="bg-accent-light border border-border rounded-lg p-4 text-sm">
            <strong>摘要: </strong>{data.summary}
          </div>
        )}

        {/* Tags */}
        <div className="mt-4 flex flex-wrap gap-2">
          {data.categories?.map((cat) => (
            <span key={cat} className="px-2 py-0.5 bg-accent-light text-accent text-xs rounded">
              {cat}
            </span>
          ))}
          {data.concepts?.map((c) => (
            <Link
              key={c}
              href={`/concept/${c.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
              className="px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs rounded hover:opacity-80"
            >
              {c}
            </Link>
          ))}
          {data.entities?.map((e) => (
            <Link
              key={e}
              href={`/entity/${e.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
              className="px-2 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-xs rounded hover:opacity-80"
            >
              {e}
            </Link>
          ))}
        </div>
      </header>

      {/* Content */}
      <div
        className="paper-content"
        dangerouslySetInnerHTML={{ __html: paper.html }}
      />

      {/* Back */}
      <div className="mt-12 pt-6 border-t border-border">
        <Link href="/" className="text-accent hover:underline text-sm">
          ← 返回论文列表
        </Link>
      </div>
    </article>
  );
}
