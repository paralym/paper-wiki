import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const LATEX_API = 'http://43.160.252.187:8765';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // 1. Check if PDF is already cached
    const pdfPath = `${slug}.pdf`;
    const { data: existing } = await supabase.storage
      .from('papers')
      .list('', { search: pdfPath });

    if (existing && existing.some(f => f.name === pdfPath)) {
      const { data: urlData } = supabase.storage.from('papers').getPublicUrl(pdfPath);
      return NextResponse.json({ status: 'ready', pdfUrl: urlData.publicUrl });
    }

    // 2. Get paper from DB
    const { data: paper } = await supabase
      .from('papers')
      .select('content, arxiv_id')
      .eq('slug', slug)
      .single();

    if (!paper?.content) {
      return NextResponse.json({ error: '论文不存在或无内容' }, { status: 404 });
    }

    // 3. Call our LaTeX compile server
    const compileRes = await fetch(`${LATEX_API}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arxiv_id: paper.arxiv_id,
        translated_body: paper.content,
      }),
    });

    if (!compileRes.ok) {
      const err = await compileRes.json().catch(() => ({ error: 'Unknown error' }));
      return NextResponse.json({ error: `编译失败: ${err.error}` }, { status: 500 });
    }

    // 4. Get PDF and upload to Supabase cache
    const pdfBuffer = Buffer.from(await compileRes.arrayBuffer());

    await supabase.storage.from('papers').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = supabase.storage.from('papers').getPublicUrl(pdfPath);
    return NextResponse.json({ status: 'ready', pdfUrl: urlData.publicUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'PDF 生成失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
