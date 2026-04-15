import { NextResponse } from 'next/server';
import { translateTexChunk } from '@/lib/translate';

export async function POST(request: Request) {
  try {
    const { text } = await request.json();
    if (!text) {
      return NextResponse.json({ error: '缺少翻译内容' }, { status: 400 });
    }

    const translated = await translateTexChunk(text);
    return NextResponse.json({ translated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '翻译出错';
    const detail = error instanceof Error ? error.stack : String(error);
    console.error('Translate error:', detail);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
