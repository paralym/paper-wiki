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

    // Each section is already a natural chunk.
    // Only split if a single section exceeds 12000 chars (very rare).
    const MAX_CHUNK = 12000;
    const chunks: { index: number; text: string; translatable: boolean }[] = [];

    for (const s of sections) {
      if (!s.translatable || s.content.length <= MAX_CHUNK) {
        chunks.push({ index: chunks.length, text: s.content, translatable: s.translatable });
      } else {
        // Split oversized section at paragraph boundaries
        const paragraphs = s.content.split(/(\n\s*\n)/);
        let batch = '';
        for (const p of paragraphs) {
          if (batch.length + p.length > MAX_CHUNK && batch.trim()) {
            chunks.push({ index: chunks.length, text: batch, translatable: true });
            batch = p;
          } else {
            batch += p;
          }
        }
        if (batch.trim()) {
          chunks.push({ index: chunks.length, text: batch, translatable: true });
        }
      }
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
