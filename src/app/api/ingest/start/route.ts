import { NextResponse } from 'next/server';
import { parseArxivId, fetchArxivMeta, downloadLatexSource, parseTexForTranslation } from '@/lib/arxiv';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: '请提供 arXiv 链接' }, { status: 400 });
    }

    const arxivId = parseArxivId(url);
    const meta = await fetchArxivMeta(arxivId);
    const texSource = await downloadLatexSource(arxivId);
    const paragraphs = parseTexForTranslation(texSource);

    // Merge consecutive short translatable paragraphs to reduce API calls,
    // but never break a paragraph — keep natural boundaries
    const MAX_CHUNK = 6000;
    const chunks: { index: number; text: string; translatable: boolean }[] = [];
    let batch = '';

    for (const p of paragraphs) {
      if (!p.translatable) {
        if (batch) {
          chunks.push({ index: chunks.length, text: batch, translatable: true });
          batch = '';
        }
        chunks.push({ index: chunks.length, text: p.content, translatable: false });
      } else {
        // Merge short paragraphs, but split at paragraph boundary if too long
        if (batch && batch.length + p.content.length > MAX_CHUNK) {
          chunks.push({ index: chunks.length, text: batch, translatable: true });
          batch = p.content;
        } else {
          batch += p.content;
        }
      }
    }
    if (batch) {
      chunks.push({ index: chunks.length, text: batch, translatable: true });
    }

    return NextResponse.json({
      meta,
      chunks,
      totalChunks: chunks.length,
      translatableChunks: chunks.filter((c) => c.translatable).length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
