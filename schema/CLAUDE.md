# Paper Wiki Schema

## 目录结构

- `wiki/papers/` — 翻译后的论文（每篇一个 .md 文件）
- `wiki/concepts/` — 概念页面（如 Transformer、Attention）
- `wiki/entities/` — 实体页面（如人物、机构）
- `wiki/sources/` — 原始 LaTeX 源码存档
- `wiki/index.md` — 自动维护的总目录
- `wiki/log.md` — 时间顺序的操作日志

## 论文页面 Frontmatter

```yaml
title: 论文中文标题
arxiv_id: "2401.12345"
authors: [作者1, 作者2]
date: 2024-01-15
categories: [cs.CL, cs.AI]
concepts: [transformer, attention]
entities: [OpenAI, Google DeepMind]
summary: 一句话摘要
```

## 概念页面 Frontmatter

```yaml
title: 概念名称
type: concept
related_papers: [arxiv_id1, arxiv_id2]
related_concepts: [concept1, concept2]
```

## 实体页面 Frontmatter

```yaml
title: 实体名称
type: entity
entity_type: person | organization | dataset | model
related_papers: [arxiv_id1, arxiv_id2]
```

## 约定

- 所有 markdown 文件兼容 Obsidian
- 使用 `[[wikilink]]` 语法做交叉引用
- 数学公式使用 `$...$` 和 `$$...$$`
- 文件名使用 kebab-case
