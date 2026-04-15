import { NextResponse } from 'next/server';
import { downloadLatexSource, parseTexForTranslation } from '@/lib/arxiv';

export async function POST(request: Request) {
  try {
    const { arxivId } = await request.json();
    if (!arxivId) {
      return NextResponse.json({ error: '缺少 arxivId' }, { status: 400 });
    }

    const texSource = await downloadLatexSource(arxivId);
    const sections = parseTexForTranslation(texSource);

    // Build chunks, splitting oversized sections
    const MAX_CHUNK = 12000;
    const chunks: { index: number; text: string; translatable: boolean }[] = [];

    for (const s of sections) {
      if (!s.translatable || s.content.length <= MAX_CHUNK) {
        chunks.push({ index: chunks.length, text: s.content, translatable: s.translatable });
      } else {
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
      chunks,
      totalChunks: chunks.length,
      translatableChunks: chunks.filter((c) => c.translatable).length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '下载失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
