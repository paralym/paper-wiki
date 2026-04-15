"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Concept {
  slug: string;
  data: {
    title: string;
    related_papers: string[];
    related_concepts: string[];
  };
}

export default function ConceptsPage() {
  const [concepts, setConcepts] = useState<Concept[]>([]);

  useEffect(() => {
    fetch("/api/concepts")
      .then((r) => r.json())
      .then(setConcepts)
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">概念索引</h1>
      {concepts.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <p>还没有概念页面</p>
          <p className="text-sm mt-2">添加论文后会自动提取概念</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {concepts.map((c) => (
            <Link
              key={c.slug}
              href={`/concept/${c.slug}`}
              className="bg-surface border border-border rounded-lg p-4 hover:border-accent transition-colors"
            >
              <h3 className="font-medium">{c.data.title}</h3>
              <p className="text-xs text-muted mt-1">
                {c.data.related_papers?.length || 0} 篇相关论文
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
