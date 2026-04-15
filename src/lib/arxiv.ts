import * as tar from 'tar';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createWriteStream } from 'fs';
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
  // Handle various arXiv URL formats
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
    const gunzipStream = createGunzip();
    const readable = Readable.from(buffer);

    // Check if it's a tar.gz by trying to decompress and extract
    const tarPath = path.join(tmpDir, 'source.tar');
    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gunzip = createGunzip();
      gunzip.on('data', (chunk) => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks)));
      gunzip.on('error', reject);
      Readable.from(buffer).pipe(gunzip);
    });

    // Check if decompressed content is a tar file (starts with file header)
    // Try to extract as tar
    await fs.writeFile(tarPath, decompressed);

    try {
      await tar.extract({ file: tarPath, cwd: tmpDir });
    } catch {
      // Not a tar, the decompressed content is the .tex file itself
      const texContent = decompressed.toString('utf-8');
      if (texContent.includes('\\begin{document}') || texContent.includes('\\documentclass')) {
        return texContent;
      }
    }
  } catch {
    // Not gzipped — might be raw LaTeX
    const raw = buffer.toString('utf-8');
    if (raw.includes('\\begin{document}') || raw.includes('\\documentclass')) {
      return raw;
    }
    throw new Error('无法解析下载的文件格式');
  }

  // Find main .tex file in extracted directory
  const texContent = await findMainTexFile(tmpDir);
  return texContent;
}

async function findMainTexFile(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const texFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.tex')) {
      texFiles.push(fullPath);
    } else if (entry.isDirectory()) {
      const subEntries = await fs.readdir(fullPath);
      for (const sub of subEntries) {
        if (sub.endsWith('.tex')) {
          texFiles.push(path.join(fullPath, sub));
        }
      }
    }
  }

  // Prefer main.tex or the file with \begin{document}
  for (const f of texFiles) {
    if (path.basename(f) === 'main.tex') {
      return await fs.readFile(f, 'utf-8');
    }
  }

  for (const f of texFiles) {
    const content = await fs.readFile(f, 'utf-8');
    if (content.includes('\\begin{document}')) {
      return content;
    }
  }

  if (texFiles.length > 0) {
    return await fs.readFile(texFiles[0], 'utf-8');
  }

  throw new Error('在源码包中未找到 .tex 文件');
}

export interface TexChunk {
  content: string;
  translatable: boolean;
}

// Non-translatable environment names
const SKIP_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'math', 'displaymath',
  'lstlisting', 'verbatim', 'minted', 'algorithmic', 'algorithm',
  'tikzpicture', 'figure', 'figure*', 'table', 'table*',
]);

export function parseTexForTranslation(tex: string): TexChunk[] {
  const chunks: TexChunk[] = [];

  const docBegin = tex.indexOf('\\begin{document}');
  const docEnd = tex.indexOf('\\end{document}');

  if (docBegin === -1) {
    chunks.push({ content: tex, translatable: true });
    return chunks;
  }

  // Preamble — don't translate
  chunks.push({
    content: tex.slice(0, docBegin + '\\begin{document}'.length),
    translatable: false,
  });

  const body = tex.slice(docBegin + '\\begin{document}'.length, docEnd >= 0 ? docEnd : undefined);

  // Split by \section (keeps each section as one big chunk for better context)
  // Pattern: split at \section but keep the delimiter
  const sectionPattern = /(?=\\(?:section|chapter)\*?\{)/;
  const sections = body.split(sectionPattern);

  for (const section of sections) {
    if (!section.trim()) continue;

    // The whole section is one translatable chunk (including its inline math,
    // figures, equations — the LLM prompt tells it to preserve those)
    chunks.push({ content: section, translatable: true });
  }

  if (docEnd >= 0) {
    chunks.push({ content: tex.slice(docEnd), translatable: false });
  }

  return chunks;
}
