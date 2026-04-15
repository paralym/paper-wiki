import * as tar from 'tar';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createGunzip } from 'zlib';

export interface ArxivMeta {
  arxivId: string;
  title: string;
  authors: string[];
  summary: string;
  categories: string[];
  published: string;
}

export function parseArxivId(input: string): string {
  const patterns = [
    /arxiv\.org\/abs\/(\d+\.\d+)/,
    /arxiv\.org\/pdf\/(\d+\.\d+)/,
    /arxiv\.org\/e-print\/(\d+\.\d+)/,
    /^(\d+\.\d+)$/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  throw new Error(`无法解析 arXiv ID: ${input}`);
}

export async function fetchArxivMeta(arxivId: string): Promise<ArxivMeta> {
  const url = `https://export.arxiv.org/api/query?id_list=${arxivId}`;
  const res = await fetch(url);
  const xml = await res.text();

  const title = xml.match(/<title>([\s\S]*?)<\/title>/g)?.[1]
    ?.replace(/<\/?title>/g, '')
    ?.replace(/\s+/g, ' ')
    ?.trim() || '';

  const authors: string[] = [];
  const authorMatches = xml.matchAll(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g);
  for (const m of authorMatches) {
    authors.push(m[1].trim());
  }

  const summary = xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() || '';

  const categories: string[] = [];
  const catMatches = xml.matchAll(/category[^>]*term="([^"]+)"/g);
  for (const m of catMatches) {
    categories.push(m[1]);
  }

  const published = xml.match(/<published>(.*?)<\/published>/)?.[1]?.slice(0, 10) || '';

  return { arxivId, title, authors, summary, categories, published };
}

export async function downloadLatexSource(arxivId: string): Promise<string> {
  const url = `https://export.arxiv.org/e-print/${arxivId}`;
  const res = await fetch(url, {
    headers: { 'Accept': '*/*' },
  });

  if (!res.ok) {
    throw new Error(`下载 LaTeX 源码失败: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arxiv-'));

  // Try extracting as tar.gz first
  try {
    const tarPath = path.join(tmpDir, 'source.tar');
    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gunzip = createGunzip();
      gunzip.on('data', (chunk) => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks)));
      gunzip.on('error', reject);
      Readable.from(buffer).pipe(gunzip);
    });

    // Check if decompressed is plain tex (not tar)
    const asText = decompressed.toString('utf-8');
    if (asText.includes('\\begin{document}') || asText.includes('\\documentclass')) {
      return asText;
    }

    // It's a tar — extract with tar package
    await fs.writeFile(tarPath, decompressed);
    try {
      await tar.extract({ file: tarPath, cwd: tmpDir });
    } catch {
      // extraction failed
    }
  } catch {
    // Not gzipped — might be raw LaTeX
    const raw = buffer.toString('utf-8');
    if (raw.includes('\\begin{document}') || raw.includes('\\documentclass')) {
      return raw;
    }
    throw new Error('无法解析下载的文件格式');
  }

  const texContent = await findMainTexFile(tmpDir);
  return texContent;
}

// Conference template file patterns — these should be skipped
const TEMPLATE_PATTERNS = [
  /^(iclr|nips|neurips|icml|acl|aaai|cvpr|eccv|iccv|emnlp|naacl|coling|sigir)/i,
  /^(template|example|sample|instructions|formatting)/i,
  /^llncs/i,  // Springer LNCS template
];

function isTemplateFile(filename: string, content: string): boolean {
  const base = path.basename(filename, '.tex');

  // Check filename patterns
  if (TEMPLATE_PATTERNS.some(p => p.test(base))) return true;

  // Check content: templates have formatting instructions, not research content
  if (content.includes('formatting instructions') ||
      content.includes('style file') ||
      content.includes('camera-ready') ||
      (content.includes('\\usepackage') && !content.includes('\\input{') && !content.includes('\\section{Introduction'))) {
    // If it looks like pure instructions with no real content sections, it's a template
    const hasResearchSections = /\\section\{(Introduction|Related|Method|Experiment|Result|Approach|Background)/i.test(content);
    if (!hasResearchSections) return true;
  }

  return false;
}

async function collectTexFiles(dir: string): Promise<string[]> {
  const texFiles: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.tex')) {
      texFiles.push(fullPath);
    } else if (entry.isDirectory()) {
      const subFiles = await collectTexFiles(fullPath);
      texFiles.push(...subFiles);
    }
  }
  return texFiles;
}

async function resolveInputs(content: string, baseDir: string): Promise<string> {
  // Recursively resolve \input{} and \include{} directives
  const inputPattern = /\\(?:input|include)\{([^}]+)\}/g;
  let result = content;
  let match;

  // Reset regex
  const matches: { full: string; file: string }[] = [];
  while ((match = inputPattern.exec(content)) !== null) {
    matches.push({ full: match[0], file: match[1] });
  }

  for (const m of matches) {
    let inputPath = m.file;
    if (!inputPath.endsWith('.tex')) inputPath += '.tex';

    const fullPath = path.join(baseDir, inputPath);
    try {
      let inputContent = await fs.readFile(fullPath, 'utf-8');
      // Recursively resolve nested inputs
      inputContent = await resolveInputs(inputContent, path.dirname(fullPath));
      result = result.replace(m.full, inputContent);
    } catch {
      // File not found, leave the \input{} as-is
    }
  }

  return result;
}

async function findMainTexFile(dir: string): Promise<string> {
  const texFiles = await collectTexFiles(dir);

  if (texFiles.length === 0) {
    throw new Error('在源码包中未找到 .tex 文件');
  }

  // Read all files
  const fileContents: { path: string; content: string; size: number }[] = [];
  for (const f of texFiles) {
    const content = await fs.readFile(f, 'utf-8');
    fileContents.push({ path: f, content, size: content.length });
  }

  // Filter out template files
  const candidates = fileContents.filter(f => !isTemplateFile(f.path, f.content));
  const pool = candidates.length > 0 ? candidates : fileContents;

  // Priority 1: file named main.tex
  const mainTex = pool.find(f => path.basename(f.path) === 'main.tex');
  if (mainTex) {
    return await resolveInputs(mainTex.content, path.dirname(mainTex.path));
  }

  // Priority 2: file with \begin{document} and \input{} (multi-file project root)
  const withInputs = pool.filter(f =>
    f.content.includes('\\begin{document}') && /\\input\{/.test(f.content)
  );
  if (withInputs.length > 0) {
    // Pick the one with the most \input{} directives (likely the root)
    withInputs.sort((a, b) => {
      const countA = (a.content.match(/\\input\{/g) || []).length;
      const countB = (b.content.match(/\\input\{/g) || []).length;
      return countB - countA;
    });
    return await resolveInputs(withInputs[0].content, path.dirname(withInputs[0].path));
  }

  // Priority 3: largest file with \begin{document}
  const withDoc = pool
    .filter(f => f.content.includes('\\begin{document}'))
    .sort((a, b) => b.size - a.size);
  if (withDoc.length > 0) {
    return await resolveInputs(withDoc[0].content, path.dirname(withDoc[0].path));
  }

  // Priority 4: largest file overall
  pool.sort((a, b) => b.size - a.size);
  return await resolveInputs(pool[0].content, path.dirname(pool[0].path));
}

export interface TexChunk {
  content: string;
  translatable: boolean;
}

export function parseTexForTranslation(tex: string): TexChunk[] {
  const chunks: TexChunk[] = [];

  const docBegin = tex.indexOf('\\begin{document}');
  const docEnd = tex.indexOf('\\end{document}');

  if (docBegin === -1) {
    chunks.push({ content: tex, translatable: true });
    return chunks;
  }

  chunks.push({
    content: tex.slice(0, docBegin + '\\begin{document}'.length),
    translatable: false,
  });

  const body = tex.slice(docBegin + '\\begin{document}'.length, docEnd >= 0 ? docEnd : undefined);

  const sectionPattern = /(?=\\(?:section|chapter)\*?\{)/;
  const sections = body.split(sectionPattern);

  for (const section of sections) {
    if (!section.trim()) continue;
    chunks.push({ content: section, translatable: true });
  }

  if (docEnd >= 0) {
    chunks.push({ content: tex.slice(docEnd), translatable: false });
  }

  return chunks;
}
