import { NextResponse } from 'next/server';
import { fetchArxivHtml, extractTextChunks, groupChunksForTranslation } from '@/lib/arxiv-html';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { arxivId } = await request.json();
    if (!arxivId) {
      return NextResponse.json({ error: '缺少 arxivId' }, { status: 400 });
    }

    const html = await fetchArxivHtml(arxivId);
    const { chunks, articleHtml } = extractTextChunks(html, arxivId);
    const groups = groupChunksForTranslation(chunks);

    const slug = arxivId.replace('.', '-');

    // Cache HTML in Supabase
    await supabase.from('html_cache').upsert({
      slug,
      html: articleHtml,
    }, { onConflict: 'slug' });

    return NextResponse.json({
      groups: groups.map((g, i) => ({
        index: i,
        chunkIds: g.chunkIds,
        text: g.text,
      })),
      totalGroups: groups.length,
      totalChunks: chunks.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '解析失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
