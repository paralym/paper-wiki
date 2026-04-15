import { NextResponse } from 'next/server';
import { deletePaper } from '@/lib/wiki';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { arxivId } = await deletePaper(slug);
    return NextResponse.json({ success: true, deleted: arxivId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '删除失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
