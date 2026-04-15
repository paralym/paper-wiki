"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Entity {
  slug: string;
  data: {
    title: string;
    entity_type: string;
    related_papers: string[];
  };
}

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([]);

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => r.json())
      .then(setEntities)
      .catch(() => {});
  }, []);

  const typeLabel: Record<string, string> = {
    person: "人物",
    organization: "机构",
    model: "模型",
    dataset: "数据集",
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">实体索引</h1>
      {entities.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <p>还没有实体页面</p>
          <p className="text-sm mt-2">添加论文后会自动提取实体</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {entities.map((e) => (
            <Link
              key={e.slug}
              href={`/entity/${e.slug}`}
              className="bg-surface border border-border rounded-lg p-4 hover:border-accent transition-colors"
            >
              <h3 className="font-medium">{e.data.title}</h3>
              <p className="text-xs text-muted mt-1">
                {typeLabel[e.data.entity_type] || e.data.entity_type} · {e.data.related_papers?.length || 0} 篇相关论文
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
