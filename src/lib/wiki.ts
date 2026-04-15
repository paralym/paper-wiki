import matter from 'gray-matter';
import { ArxivMeta } from './arxiv';
import { ExtractedKnowledge } from './translate';
import { getFile, putFile, listDir } from './github';

export async function savePaper(
  meta: ArxivMeta,
  knowledge: ExtractedKnowledge,
  translatedTex: string
): Promise<string> {
  const slug = meta.arxivId.replace('.', '-');
  const filePath = `wiki/papers/${slug}.md`;

  const frontmatter = {
    title: knowledge.titleCn || meta.title,
    title_en: meta.title,
    arxiv_id: meta.arxivId,
    authors: meta.authors,
    date: meta.published,
    categories: meta.categories,
    concepts: knowledge.concepts.map((c) => c.name),
    entities: knowledge.entities.map((e) => e.name),
    summary: knowledge.summary,
  };

  const markdownContent = cleanMarkdown(translatedTex);
  const content = matter.stringify(markdownContent, frontmatter);

  const existing = await getFile(filePath);
  await putFile(filePath, content, `add paper: ${meta.arxivId}`, existing?.sha);

  return slug;
}

function cleanMarkdown(md: string): string {
  // LLM already outputs Markdown, just clean up residual LaTeX if any
  let out = md;

  // Remove any remaining document environment markers
  out = out.replace(/\\begin\{document\}/g, '');
  out = out.replace(/\\end\{document\}/g, '');

  // Clean up any leftover simple LaTeX commands the LLM missed
  out = out.replace(/\\maketitle/g, '');
  out = out.replace(/\\tableofcontents/g, '');
  out = out.replace(/\\newpage/g, '');
  out = out.replace(/\\noindent\s*/g, '');
  out = out.replace(/\\label\{[^}]*\}/g, '');

  // Normalize spacing
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.trim();

  return out;
}

export async function updateConceptPage(
  concept: { name: string; description: string },
  arxivId: string
): Promise<void> {
  const slug = concept.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filePath = `wiki/concepts/${slug}.md`;

  const existing = await getFile(filePath);
  if (existing) {
    const { data, content } = matter(existing.content);
    if (!data.related_papers) data.related_papers = [];
    if (!data.related_papers.includes(arxivId)) {
      data.related_papers.push(arxivId);
    }
    await putFile(filePath, matter.stringify(content, data), `update concept: ${concept.name}`, existing.sha);
  } else {
    const frontmatter = {
      title: concept.name,
      type: 'concept',
      related_papers: [arxivId],
      related_concepts: [],
    };
    const content = `# ${concept.name}\n\n${concept.description}\n\n## 相关论文\n\n- [[${arxivId.replace('.', '-')}]]\n`;
    await putFile(filePath, matter.stringify(content, frontmatter), `add concept: ${concept.name}`);
  }
}

export async function updateEntityPage(
  entity: { name: string; type: string; description: string },
  arxivId: string
): Promise<void> {
  const slug = entity.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filePath = `wiki/entities/${slug}.md`;

  const existing = await getFile(filePath);
  if (existing) {
    const { data, content } = matter(existing.content);
    if (!data.related_papers) data.related_papers = [];
    if (!data.related_papers.includes(arxivId)) {
      data.related_papers.push(arxivId);
    }
    await putFile(filePath, matter.stringify(content, data), `update entity: ${entity.name}`, existing.sha);
  } else {
    const frontmatter = {
      title: entity.name,
      type: 'entity',
      entity_type: entity.type,
      related_papers: [arxivId],
    };
    const content = `# ${entity.name}\n\n${entity.description}\n\n## 相关论文\n\n- [[${arxivId.replace('.', '-')}]]\n`;
    await putFile(filePath, matter.stringify(content, frontmatter), `add entity: ${entity.name}`);
  }
}

export async function updateIndex(): Promise<void> {
  const papers = await readMarkdownDir('wiki/papers');
  const concepts = await readMarkdownDir('wiki/concepts');
  const entities = await readMarkdownDir('wiki/entities');

  let index = `---\ntitle: Paper Wiki 索引\nupdated: ${new Date().toISOString().slice(0, 10)}\n---\n\n# Paper Wiki 索引\n\n`;

  index += `## 论文 (${papers.length})\n\n`;
  for (const p of papers) {
    index += `- [[${p.slug}|${p.data.title}]] — ${p.data.summary || ''}\n`;
  }

  index += `\n## 概念 (${concepts.length})\n\n`;
  for (const c of concepts) {
    index += `- [[${c.slug}|${c.data.title}]] (${c.data.related_papers?.length || 0} 篇论文)\n`;
  }

  index += `\n## 实体 (${entities.length})\n\n`;
  for (const e of entities) {
    index += `- [[${e.slug}|${e.data.title}]] [${e.data.entity_type || ''}] (${e.data.related_papers?.length || 0} 篇论文)\n`;
  }

  const existing = await getFile('wiki/index.md');
  await putFile('wiki/index.md', index, 'update index', existing?.sha);
}

export async function appendLog(arxivId: string, title: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n## [${date}] ingest | ${title}\n- arXiv ID: ${arxivId}\n- 操作: 下载、翻译、生成知识页面\n`;

  const existing = await getFile('wiki/log.md');
  const content = (existing?.content || '---\ntitle: 操作日志\n---\n\n# 操作日志\n') + entry;
  await putFile('wiki/log.md', content, `log: ingest ${arxivId}`, existing?.sha);
}

async function readMarkdownDir(dirPath: string) {
  const files = await listDir(dirPath);
  const results = [];
  for (const f of files) {
    if (!f.name.endsWith('.md')) continue;
    const file = await getFile(f.path);
    if (!file) continue;
    const { data } = matter(file.content);
    results.push({ slug: f.name.replace('.md', ''), data });
  }
  return results;
}

export async function listPapers() {
  const files = await listDir('wiki/papers');
  const results = [];
  for (const f of files) {
    if (!f.name.endsWith('.md') && !f.name.endsWith('.json')) continue;
    const file = await getFile(f.path);
    if (!file) continue;
    if (f.name.endsWith('.json')) {
      try {
        const data = JSON.parse(file.content);
        results.push({ slug: f.name.replace('.json', ''), data });
      } catch { continue; }
    } else {
      const { data } = matter(file.content);
      results.push({ slug: f.name.replace('.md', ''), data });
    }
  }
  return results;
}

export async function listConcepts() {
  return readMarkdownDir('wiki/concepts');
}

export async function listEntities() {
  return readMarkdownDir('wiki/entities');
}

export async function getPaperContent(slug: string) {
  // Try JSON first (HTML mode), then markdown
  const jsonFile = await getFile(`wiki/papers/${slug}.json`);
  if (jsonFile) {
    const data = JSON.parse(jsonFile.content);
    return { data, content: '', mode: 'html' as const };
  }
  const mdFile = await getFile(`wiki/papers/${slug}.md`);
  if (!mdFile) throw new Error('论文未找到');
  const parsed = matter(mdFile.content);
  return { data: parsed.data, content: parsed.content, mode: 'markdown' as const };
}

export async function getConceptContent(slug: string) {
  const file = await getFile(`wiki/concepts/${slug}.md`);
  if (!file) throw new Error('概念未找到');
  return matter(file.content);
}

export async function getEntityContent(slug: string) {
  const file = await getFile(`wiki/entities/${slug}.md`);
  if (!file) throw new Error('实体未找到');
  return matter(file.content);
}
