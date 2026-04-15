import { NextResponse } from 'next/server';
import { downloadLatexSource } from '@/lib/arxiv';

// Step: download LaTeX source and return raw tex content
export async function POST(request: Request) {
  try {
    const { arxivId } = await request.json();
    if (!arxivId) {
      return NextResponse.json({ error: '缺少 arxivId' }, { status: 400 });
    }

    const texSource = await downloadLatexSource(arxivId);
    return NextResponse.json({ tex: texSource });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '下载失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
