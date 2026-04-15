"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

export default function ConceptPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [concept, setConcept] = useState<{ data: Record<string, unknown>; html: string } | null>(null);

  useEffect(() => {
    fetch(`/api/papers/${slug}`)
      .catch(() => null);
    // For now, show concept info from the concepts API
    fetch(`/api/concepts`)
      .then((r) => r.json())
      .then((concepts) => {
        const found = concepts.find((c: { slug: string }) => c.slug === slug);
        if (found) {
          setConcept({ data: found.data, html: "" });
        }
      })
      .catch(() => {});
  }, [slug]);

  if (!concept) {
    return <div className="text-center py-12 text-muted">加载中...</div>;
  }

  const data = concept.data;
  const relatedPapers = (data.related_papers as string[]) || [];

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{data.title as string}</h1>
      <div className="mb-6">
        <span className="px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs rounded">
          概念
        </span>
      </div>

      {relatedPapers.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">相关论文</h2>
          <ul className="space-y-2">
            {relatedPapers.map((id) => (
              <li key={id}>
                <Link
                  href={`/paper/${id.replace(".", "-")}`}
                  className="text-accent hover:underline"
                >
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8">
        <Link href="/concepts" className="text-accent hover:underline text-sm">
          ← 返回概念索引
        </Link>
      </div>
    </div>
  );
}
