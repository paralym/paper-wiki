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

/**
 * Download and extract arXiv source to a temp directory.
 * Returns { dir, singleFile } — if it's a single .tex file, singleFile has its content.
 */
export async function downloadAndExtract(arxivId: string): Promise<{ dir: string; singleFile?: string }> {
  const url = `https://export.arxiv.org/e-print/${arxivId}`;
  const res = await fetch(url, {
    headers: { 'Accept': '*/*' },
  });

  if (!res.ok) {
    throw new Error(`下载 LaTeX 源码失败: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arxiv-'));

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

    const asText = decompressed.toString('utf-8');
    if (asText.includes('\\begin{document}') || asText.includes('\\documentclass')) {
      return { dir: tmpDir, singleFile: asText };
    }

    await fs.writeFile(tarPath, decompressed);
    try {
      await tar.extract({ file: tarPath, cwd: tmpDir });
    } catch {
      // extraction failed
    }
  } catch {
    const raw = buffer.toString('utf-8');
    if (raw.includes('\\begin{document}') || raw.includes('\\documentclass')) {
      return { dir: tmpDir, singleFile: raw };
    }
    throw new Error('无法解析下载的文件格式');
  }

  return { dir: tmpDir };
}

// Keep backward compat
export async function downloadLatexSource(arxivId: string): Promise<string> {
  const { dir, singleFile } = await downloadAndExtract(arxivId);
  if (singleFile) return singleFile;
  return await legacyFindMainFile(dir);
}

async function legacyFindMainFile(dir: string): Promise<string> {
  const texFiles = await collectTexFiles(dir);
  if (texFiles.length === 0) throw new Error('未找到 .tex 文件');
  for (const f of texFiles) {
    if (path.basename(f) === 'main.tex') {
      const content = await fs.readFile(f, 'utf-8');
      return await resolveInputs(content, path.dirname(f));
    }
  }
  const contents = await Promise.all(texFiles.map(async f => ({
    path: f, content: await fs.readFile(f, 'utf-8')
  })));
  const withDoc = contents.filter(f => f.content.includes('\\begin{document}'));
  withDoc.sort((a, b) => b.content.length - a.content.length);
  if (withDoc.length > 0) {
    return await resolveInputs(withDoc[0].content, path.dirname(withDoc[0].path));
  }
  return contents[0].content;
}

export async function collectTexFiles(dir: string): Promise<string[]> {
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

export async function resolveInputs(content: string, baseDir: string): Promise<string> {
  const inputPattern = /\\(?:input|include)\{([^}]+)\}/g;
  let result = content;

  const matches: { full: string; file: string }[] = [];
  let match;
  while ((match = inputPattern.exec(content)) !== null) {
    matches.push({ full: match[0], file: match[1] });
  }

  console.log(`[resolveInputs] baseDir=${baseDir}, found ${matches.length} \\input commands`);

  for (const m of matches) {
    let inputPath = m.file;
    // Try with and without .tex extension
    const candidates = [
      path.join(baseDir, inputPath),
      path.join(baseDir, inputPath + '.tex'),
    ];

    let resolved = false;
    for (const fullPath of candidates) {
      try {
        let inputContent = await fs.readFile(fullPath, 'utf-8');
        console.log(`[resolveInputs] OK: ${m.full} → ${fullPath} (${inputContent.length} chars)`);
        inputContent = await resolveInputs(inputContent, path.dirname(fullPath));
        result = result.replace(m.full, inputContent);
        resolved = true;
        break;
      } catch {
        // Try next candidate
      }
    }

    if (!resolved) {
      console.log(`[resolveInputs] FAILED: ${m.full} — tried: ${candidates.join(', ')}`);
    }
  }

  return result;
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
