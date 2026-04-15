import { NextResponse } from 'next/server';
import { parseArxivId, fetchArxivMeta } from '@/lib/arxiv';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: '请提供 arXiv 链接' }, { status: 400 });
    }

    const arxivId = parseArxivId(url);
    const meta = await fetchArxivMeta(arxivId);

    return NextResponse.json({ meta });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
