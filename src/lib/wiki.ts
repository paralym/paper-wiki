import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { ArxivMeta } from './arxiv';
import { ExtractedKnowledge } from './translate';

const WIKI_DIR = path.join(process.cwd(), 'wiki');

export async function savePaper(
  meta: ArxivMeta,
  knowledge: ExtractedKnowledge,
  translatedTex: string
): Promise<string> {
  const slug = meta.arxivId.replace('.', '-');
  const filePath = path.join(WIKI_DIR, 'papers', `${slug}.md`);

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

  // Convert LaTeX to simplified markdown-friendly format
  const markdownContent = texToMarkdown(translatedTex);

  const content = matter.stringify(markdownContent, frontmatter);
  await fs.writeFile(filePath, content, 'utf-8');

  return slug;
}

function texToMarkdown(tex: string): string {
  let md = tex;

  // Remove preamble
  const docBegin = md.indexOf('\\begin{document}');
  if (docBegin !== -1) {
    md = md.slice(docBegin + '\\begin{document}'.length);
  }
  const docEnd = md.indexOf('\\end{document}');
  if (docEnd !== -1) {
    md = md.slice(0, docEnd);
  }

  // Convert sections
  md = md.replace(/\\section\*?\{(.*?)\}/g, '\n## $1\n');
  md = md.replace(/\\subsection\*?\{(.*?)\}/g, '\n### $1\n');
  md = md.replace(/\\subsubsection\*?\{(.*?)\}/g, '\n#### $1\n');

  // Convert formatting
  md = md.replace(/\\textbf\{(.*?)\}/g, '**$1**');
  md = md.replace(/\\textit\{(.*?)\}/g, '*$1*');
  md = md.replace(/\\emph\{(.*?)\}/g, '*$1*');
  md = md.replace(/\\underline\{(.*?)\}/g, '<u>$1</u>');

  // Convert lists
  md = md.replace(/\\begin\{itemize\}/g, '');
  md = md.replace(/\\end\{itemize\}/g, '');
  md = md.replace(/\\begin\{enumerate\}/g, '');
  md = md.replace(/\\end\{enumerate\}/g, '');
  md = md.replace(/\\item\s*/g, '- ');

  // Convert abstract
  md = md.replace(/\\begin\{abstract\}/g, '\n## 摘要\n');
  md = md.replace(/\\end\{abstract\}/g, '\n');

  // Keep math as-is (KaTeX compatible)
  // Display math: \[...\] → $$...$$
  md = md.replace(/\\\[([\s\S]*?)\\\]/g, '\n$$\n$1\n$$\n');

  // Remove common commands
  md = md.replace(/\\maketitle/g, '');
  md = md.replace(/\\tableofcontents/g, '');
  md = md.replace(/\\newpage/g, '');
  md = md.replace(/\\noindent/g, '');
  md = md.replace(/\\\\(\s*\n)/g, '\n');

  // Citations
  md = md.replace(/\\cite[pt]?\{(.*?)\}/g, '[$1]');

  // Footnotes
  md = md.replace(/\\footnote\{(.*?)\}/g, ' ($1)');

  // Clean up
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

export async function updateConceptPage(
  concept: { name: string; description: string },
  arxivId: string
): Promise<void> {
  const slug = concept.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filePath = path.join(WIKI_DIR, 'concepts', `${slug}.md`);

  try {
    // Update existing page
    const existing = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(existing);

    if (!data.related_papers) data.related_papers = [];
    if (!data.related_papers.includes(arxivId)) {
      data.related_papers.push(arxivId);
    }

    await fs.writeFile(filePath, matter.stringify(content, data), 'utf-8');
  } catch {
    // Create new page
    const frontmatter = {
      title: concept.name,
      type: 'concept',
      related_papers: [arxivId],
      related_concepts: [],
    };

    const content = `# ${concept.name}\n\n${concept.description}\n\n## 相关论文\n\n- [[${arxivId.replace('.', '-')}]]\n`;
    await fs.writeFile(filePath, matter.stringify(content, frontmatter), 'utf-8');
  }
}

export async function updateEntityPage(
  entity: { name: string; type: string; description: string },
  arxivId: string
): Promise<void> {
  const slug = entity.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const filePath = path.join(WIKI_DIR, 'entities', `${slug}.md`);

  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(existing);

    if (!data.related_papers) data.related_papers = [];
    if (!data.related_papers.includes(arxivId)) {
      data.related_papers.push(arxivId);
    }

    await fs.writeFile(filePath, matter.stringify(content, data), 'utf-8');
  } catch {
    const frontmatter = {
      title: entity.name,
      type: 'entity',
      entity_type: entity.type,
      related_papers: [arxivId],
    };

    const content = `# ${entity.name}\n\n${entity.description}\n\n## 相关论文\n\n- [[${arxivId.replace('.', '-')}]]\n`;
    await fs.writeFile(filePath, matter.stringify(content, frontmatter), 'utf-8');
  }
}

export async function updateIndex(): Promise<void> {
  const papersDir = path.join(WIKI_DIR, 'papers');
  const conceptsDir = path.join(WIKI_DIR, 'concepts');
  const entitiesDir = path.join(WIKI_DIR, 'entities');

  const papers = await readMarkdownDir(papersDir);
  const concepts = await readMarkdownDir(conceptsDir);
  const entities = await readMarkdownDir(entitiesDir);

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

  await fs.writeFile(path.join(WIKI_DIR, 'index.md'), index, 'utf-8');
}

export async function appendLog(arxivId: string, title: string): Promise<void> {
  const logPath = path.join(WIKI_DIR, 'log.md');
  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n## [${date}] ingest | ${title}\n- arXiv ID: ${arxivId}\n- 操作: 下载、翻译、生成知识页面\n`;

  const existing = await fs.readFile(logPath, 'utf-8');
  await fs.writeFile(logPath, existing + entry, 'utf-8');
}

async function readMarkdownDir(dir: string) {
  try {
    const files = await fs.readdir(dir);
    const results = [];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const content = await fs.readFile(path.join(dir, f), 'utf-8');
      const { data } = matter(content);
      results.push({ slug: f.replace('.md', ''), data });
    }
    return results;
  } catch {
    return [];
  }
}

export async function listPapers() {
  return readMarkdownDir(path.join(WIKI_DIR, 'papers'));
}

export async function listConcepts() {
  return readMarkdownDir(path.join(WIKI_DIR, 'concepts'));
}

export async function listEntities() {
  return readMarkdownDir(path.join(WIKI_DIR, 'entities'));
}

export async function getPaperContent(slug: string) {
  const filePath = path.join(WIKI_DIR, 'papers', `${slug}.md`);
  const content = await fs.readFile(filePath, 'utf-8');
  return matter(content);
}

export async function getConceptContent(slug: string) {
  const filePath = path.join(WIKI_DIR, 'concepts', `${slug}.md`);
  const content = await fs.readFile(filePath, 'utf-8');
  return matter(content);
}

export async function getEntityContent(slug: string) {
  const filePath = path.join(WIKI_DIR, 'entities', `${slug}.md`);
  const content = await fs.readFile(filePath, 'utf-8');
  return matter(content);
}
