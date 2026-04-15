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

  const markdownContent = texToMarkdown(translatedTex);
  const content = matter.stringify(markdownContent, frontmatter);

  const existing = await getFile(filePath);
  await putFile(filePath, content, `add paper: ${meta.arxivId}`, existing?.sha);

  return slug;
}

function texToMarkdown(tex: string): string {
  let md = tex;

  const docBegin = md.indexOf('\\begin{document}');
  if (docBegin !== -1) {
    md = md.slice(docBegin + '\\begin{document}'.length);
  }
  const docEnd = md.indexOf('\\end{document}');
  if (docEnd !== -1) {
    md = md.slice(0, docEnd);
  }

  md = md.replace(/\\section\*?\{(.*?)\}/g, '\n## $1\n');
  md = md.replace(/\\subsection\*?\{(.*?)\}/g, '\n### $1\n');
  md = md.replace(/\\subsubsection\*?\{(.*?)\}/g, '\n#### $1\n');

  md = md.replace(/\\textbf\{(.*?)\}/g, '**$1**');
  md = md.replace(/\\textit\{(.*?)\}/g, '*$1*');
  md = md.replace(/\\emph\{(.*?)\}/g, '*$1*');
  md = md.replace(/\\underline\{(.*?)\}/g, '<u>$1</u>');

  md = md.replace(/\\begin\{itemize\}/g, '');
  md = md.replace(/\\end\{itemize\}/g, '');
  md = md.replace(/\\begin\{enumerate\}/g, '');
  md = md.replace(/\\end\{enumerate\}/g, '');
  md = md.replace(/\\item\s*/g, '- ');

  md = md.replace(/\\begin\{abstract\}/g, '\n## 摘要\n');
  md = md.replace(/\\end\{abstract\}/g, '\n');

  md = md.replace(/\\\[([\s\S]*?)\\\]/g, '\n$$\n$1\n$$\n');

  md = md.replace(/\\maketitle/g, '');
  md = md.replace(/\\tableofcontents/g, '');
  md = md.replace(/\\newpage/g, '');
  md = md.replace(/\\noindent/g, '');
  md = md.replace(/\\\\(\s*\n)/g, '\n');

  md = md.replace(/\\cite[pt]?\{(.*?)\}/g, '[$1]');
  md = md.replace(/\\footnote\{(.*?)\}/g, ' ($1)');

  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
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
  return readMarkdownDir('wiki/papers');
}

export async function listConcepts() {
  return readMarkdownDir('wiki/concepts');
}

export async function listEntities() {
  return readMarkdownDir('wiki/entities');
}

export async function getPaperContent(slug: string) {
  const file = await getFile(`wiki/papers/${slug}.md`);
  if (!file) throw new Error('论文未找到');
  return matter(file.content);
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
