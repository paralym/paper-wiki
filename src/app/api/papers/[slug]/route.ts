import { NextResponse } from 'next/server';
import { getPaperContent } from '@/lib/wiki';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const result = await getPaperContent(slug);
    return NextResponse.json({
      data: result.data,
      content: result.content,
    });
  } catch {
    return NextResponse.json({ error: '论文未找到' }, { status: 404 });
  }
}
