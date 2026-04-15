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

export interface TexSection {
  type: 'preamble' | 'text' | 'math' | 'environment' | 'command';
  content: string;
  translatable: boolean;
}

export function parseTexForTranslation(tex: string): TexSection[] {
  const sections: TexSection[] = [];

  // Split into document preamble and body
  const docBegin = tex.indexOf('\\begin{document}');
  const docEnd = tex.indexOf('\\end{document}');

  if (docBegin === -1) {
    // No document environment, treat as all translatable
    sections.push({ type: 'text', content: tex, translatable: true });
    return sections;
  }

  // Preamble — don't translate
  sections.push({
    type: 'preamble',
    content: tex.slice(0, docBegin + '\\begin{document}'.length),
    translatable: false,
  });

  const body = tex.slice(docBegin + '\\begin{document}'.length, docEnd >= 0 ? docEnd : undefined);

  // Split body into chunks: math blocks, commands, and text
  // We translate text portions and leave math/commands intact
  const chunks = splitTexBody(body);
  sections.push(...chunks);

  if (docEnd >= 0) {
    sections.push({
      type: 'command',
      content: tex.slice(docEnd),
      translatable: false,
    });
  }

  return sections;
}

function splitTexBody(body: string): TexSection[] {
  const sections: TexSection[] = [];

  // Regex to match math environments and display math
  const mathPattern = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\begin\{(equation|align|gather|multline|eqnarray|math|displaymath)\*?\}[\s\S]*?\\end\{\2\*?\})/g;

  // Non-translatable environments
  const codePattern = /\\begin\{(lstlisting|verbatim|minted|algorithmic|algorithm|tikzpicture|figure|table)\*?\}[\s\S]*?\\end\{\1\*?\}/g;

  // Combine all non-translatable patterns
  const skipPattern = new RegExp(
    `(${mathPattern.source}|${codePattern.source}|\\\\(?:label|ref|cite|citep|citet|url|href|includegraphics|bibliography|bibliographystyle)\\{[^}]*\\})`,
    'g'
  );

  let lastIndex = 0;
  let match;

  const combined = new RegExp(skipPattern.source, 'g');

  while ((match = combined.exec(body)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      const text = body.slice(lastIndex, match.index);
      if (text.trim()) {
        sections.push({ type: 'text', content: text, translatable: true });
      } else {
        sections.push({ type: 'text', content: text, translatable: false });
      }
    }

    // The non-translatable match
    sections.push({
      type: match[0].startsWith('$') || match[0].startsWith('\\[') || match[0].startsWith('\\(') || match[0].startsWith('\\begin{equation')
        ? 'math' : 'environment',
      content: match[0],
      translatable: false,
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < body.length) {
    const text = body.slice(lastIndex);
    if (text.trim()) {
      sections.push({ type: 'text', content: text, translatable: true });
    } else {
      sections.push({ type: 'text', content: text, translatable: false });
    }
  }

  return sections;
}
