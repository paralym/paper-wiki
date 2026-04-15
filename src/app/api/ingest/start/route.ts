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
    const sections = parseTexForTranslation(texSource);

    // Merge translatable sections into reasonable chunks for per-call translation
    const chunks: { index: number; text: string; translatable: boolean }[] = [];
    let batch = '';
    let batchStart = 0;
    const BATCH_SIZE = 6000;

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s.translatable) {
        if (batch.trim()) {
          chunks.push({ index: chunks.length, text: batch, translatable: true });
          batch = '';
        }
        chunks.push({ index: chunks.length, text: s.content, translatable: false });
      } else {
        if (batch.length + s.content.length > BATCH_SIZE && batch.trim()) {
          chunks.push({ index: chunks.length, text: batch, translatable: true });
          batch = s.content;
        } else {
          batch += s.content;
        }
      }
    }
    if (batch.trim()) {
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
