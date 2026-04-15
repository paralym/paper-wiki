import { NextResponse } from 'next/server';
import { fetchArxivHtml, extractTextChunks, groupChunksForTranslation } from '@/lib/arxiv-html';

export async function POST(request: Request) {
  try {
    const { arxivId } = await request.json();
    if (!arxivId) {
      return NextResponse.json({ error: '缺少 arxivId' }, { status: 400 });
    }

    const html = await fetchArxivHtml(arxivId);
    const { chunks, articleHtml } = extractTextChunks(html);
    const groups = groupChunksForTranslation(chunks);

    // Store the full HTML in the response for later assembly
    // But to avoid payload limits, we store it via GitHub
    const { putFile, getFile } = await import('@/lib/github');
    const cachePath = `wiki/sources/${arxivId.replace('.', '-')}-html.txt`;
    const existing = await getFile(cachePath);
    await putFile(cachePath, articleHtml, `cache html: ${arxivId}`, existing?.sha);

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
