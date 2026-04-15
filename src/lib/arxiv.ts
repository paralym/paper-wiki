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
  const inputPattern = /\\(?:input|include)\{([^}]+)\}/g;
  let result = content;

  const matches: { full: string; file: string }[] = [];
  let match;
  while ((match = inputPattern.exec(content)) !== null) {
    matches.push({ full: match[0], file: match[1] });
  }

  for (const m of matches) {
    let inputPath = m.file;
    if (!inputPath.endsWith('.tex')) inputPath += '.tex';

    const fullPath = path.join(baseDir, inputPath);
    try {
      let inputContent = await fs.readFile(fullPath, 'utf-8');
      inputContent = await resolveInputs(inputContent, path.dirname(fullPath));
      result = result.replace(m.full, inputContent);
    } catch {
      // File not found, leave as-is
    }
  }

  return result;
}

async function findMainTexFile(dir: string): Promise<string> {
  const texFiles = await collectTexFiles(dir);

  if (texFiles.length === 0) {
    throw new Error('在源码包中未找到 .tex 文件');
  }

  // Read all files with previews
  const fileInfos: { path: string; relPath: string; content: string; size: number; preview: string }[] = [];
  for (const f of texFiles) {
    const content = await fs.readFile(f, 'utf-8');
    const relPath = path.relative(dir, f);
    // First 30 lines as preview
    const preview = content.split('\n').slice(0, 30).join('\n');
    fileInfos.push({ path: f, relPath, content, size: content.length, preview });
  }

  // If only one .tex file with \begin{document}, use it directly
  const withDoc = fileInfos.filter(f => f.content.includes('\\begin{document}'));
  if (withDoc.length === 1) {
    return await resolveInputs(withDoc[0].content, path.dirname(withDoc[0].path));
  }

  // Multiple candidates — ask LLM to pick the main paper file
  const { getClient } = await import('./translate');
  const MODEL = 'gemini-3-flash-preview';

  const fileSummary = fileInfos.map(f =>
    `=== ${f.relPath} (${f.size} chars) ===\n${f.preview}\n`
  ).join('\n');

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Below are .tex files from an arXiv paper source package. Each shows the filename and first 30 lines.

Which file is the MAIN paper file (the root file that should be compiled, NOT a conference template/formatting guide)?

${fileSummary}

Reply with ONLY the filename (e.g. "main.tex" or "paper.tex"), nothing else.`,
    }],
  });

  const chosen = response.choices[0]?.message?.content?.trim() || '';

  // Find the chosen file
  const selected = fileInfos.find(f =>
    f.relPath === chosen || path.basename(f.relPath) === chosen
  );

  if (selected) {
    return await resolveInputs(selected.content, path.dirname(selected.path));
  }

  // Fallback: largest file with \begin{document}
  if (withDoc.length > 0) {
    withDoc.sort((a, b) => b.size - a.size);
    return await resolveInputs(withDoc[0].content, path.dirname(withDoc[0].path));
  }

  fileInfos.sort((a, b) => b.size - a.size);
  return await resolveInputs(fileInfos[0].content, path.dirname(fileInfos[0].path));
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
