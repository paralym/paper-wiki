import { NextResponse } from 'next/server';
import { getPaperContent } from '@/lib/wiki';
import { renderMarkdown } from '@/lib/markdown';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const result = await getPaperContent(slug);

    if (result.mode === 'html') {
      return NextResponse.json({
        data: result.data,
        mode: 'html',
        originalHtml: result.data.original_html,
        translatedHtml: result.data.translated_html,
      });
    }

    const html = await renderMarkdown(result.content);
    return NextResponse.json({
      data: result.data,
      mode: 'markdown',
      html,
      content: result.content,
    });
  } catch {
    return NextResponse.json({ error: '论文未找到' }, { status: 404 });
  }
}
