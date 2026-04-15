import { NextResponse } from 'next/server';
import { extractGlossary } from '@/lib/translate';

export async function POST(request: Request) {
  try {
    const { text } = await request.json();
    if (!text) {
      return NextResponse.json({ error: '缺少内容' }, { status: 400 });
    }

    const glossary = await extractGlossary(text);
    return NextResponse.json({ glossary });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '术语提取失败';
    console.error('Glossary error:', message);
    return NextResponse.json({ glossary: {} });
  }
}
