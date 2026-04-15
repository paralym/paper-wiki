import { Readable } from 'stream';
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

  // Try gzip decompress
  let decompressed: Buffer;
  try {
    decompressed = await gunzipBuffer(buffer);
  } catch {
    // Not gzipped — might be raw LaTeX
    const raw = buffer.toString('utf-8');
    if (raw.includes('\\begin{document}') || raw.includes('\\documentclass')) {
      return raw;
    }
    throw new Error('无法解析下载的文件格式');
  }

  // Check if decompressed content is plain .tex
  const asText = decompressed.toString('utf-8');
  if (asText.includes('\\begin{document}') || asText.includes('\\documentclass')) {
    return asText;
  }

  // It's a tar — parse in memory
  const texFiles = parseTarBuffer(decompressed);

  if (texFiles.length === 0) {
    throw new Error('在源码包中未找到 .tex 文件');
  }

  // Prefer main.tex
  const mainTex = texFiles.find(f => f.name === 'main.tex' || f.name.endsWith('/main.tex'));
  if (mainTex) return mainTex.content;

  // Then file with \begin{document}
  const docTex = texFiles.find(f => f.content.includes('\\begin{document}'));
  if (docTex) return docTex.content;

  return texFiles[0].content;
}

function gunzipBuffer(buf: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    gunzip.on('data', (chunk) => chunks.push(chunk));
    gunzip.on('end', () => resolve(Buffer.concat(chunks)));
    gunzip.on('error', reject);
    Readable.from(buf).pipe(gunzip);
  });
}

// Minimal tar parser — reads file entries from a tar buffer in memory
function parseTarBuffer(buf: Buffer): { name: string; content: string }[] {
  const files: { name: string; content: string }[] = [];
  let offset = 0;

  while (offset + 512 <= buf.length) {
    // Read header (512 bytes)
    const header = buf.subarray(offset, offset + 512);

    // Check for end-of-archive (two zero blocks)
    if (header.every(b => b === 0)) break;

    // File name: bytes 0-99
    const nameEnd = header.indexOf(0, 0);
    const name = header.subarray(0, Math.min(nameEnd >= 0 ? nameEnd : 100, 100)).toString('utf-8');

    // File size: bytes 124-135 (octal string)
    const sizeStr = header.subarray(124, 136).toString('utf-8').trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Type flag: byte 156 ('0' or '\0' = regular file, '5' = directory)
    const typeFlag = header[156];

    offset += 512; // move past header

    if ((typeFlag === 48 || typeFlag === 0) && size > 0) {
      // Regular file
      const content = buf.subarray(offset, offset + size).toString('utf-8');
      if (name.endsWith('.tex')) {
        files.push({ name, content });
      }
    }

    // Move past file data (padded to 512-byte blocks)
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
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

  // Preamble — don't translate
  chunks.push({
    content: tex.slice(0, docBegin + '\\begin{document}'.length),
    translatable: false,
  });

  const body = tex.slice(docBegin + '\\begin{document}'.length, docEnd >= 0 ? docEnd : undefined);

  // Split by \section (keeps each section as one big chunk for better context)
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
