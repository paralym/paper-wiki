import { NextResponse } from 'next/server';
import { getPaperContent } from '@/lib/wiki';
import { renderMarkdown } from '@/lib/markdown';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { data, content } = await getPaperContent(slug);
    const html = await renderMarkdown(content);
    return NextResponse.json({ data, html, content });
  } catch {
    return NextResponse.json({ error: '论文未找到' }, { status: 404 });
  }
}
