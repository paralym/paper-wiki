"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";

export default function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [entity, setEntity] = useState<{ data: Record<string, unknown> } | null>(null);

  useEffect(() => {
    fetch(`/api/entities`)
      .then((r) => r.json())
      .then((entities) => {
        const found = entities.find((e: { slug: string }) => e.slug === slug);
        if (found) {
          setEntity({ data: found.data });
        }
      })
      .catch(() => {});
  }, [slug]);

  if (!entity) {
    return <div className="text-center py-12 text-muted">加载中...</div>;
  }

  const data = entity.data;
  const typeLabel: Record<string, string> = {
    person: "人物",
    organization: "机构",
    model: "模型",
    dataset: "数据集",
  };
  const relatedPapers = (data.related_papers as string[]) || [];

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{data.title as string}</h1>
      <div className="mb-6">
        <span className="px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 text-xs rounded">
          {typeLabel[data.entity_type as string] || data.entity_type as string}
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
        <Link href="/entities" className="text-accent hover:underline text-sm">
          ← 返回实体索引
        </Link>
      </div>
    </div>
  );
}
