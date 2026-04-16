import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
      return NextResponse.json({ pdfUrl: urlData.publicUrl, cached: true });
    }

    // 2. Get LaTeX from DB
    const { data: paper } = await supabase
      .from('papers')
      .select('content')
      .eq('slug', slug)
      .single();

    if (!paper?.content) {
      return NextResponse.json({ error: '论文不存在或无内容' }, { status: 404 });
    }

    // 3. Upload LaTeX to Supabase Storage (fast, within 10s)
    const texPath = `${slug}.tex`;
    const texBlob = new Blob([paper.content], { type: 'text/plain' });
    const { error: uploadError } = await supabase.storage
      .from('papers')
      .upload(texPath, texBlob, {
        contentType: 'text/x-tex',
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({
        error: `上传 LaTeX 到 Supabase 失败: ${uploadError.message}。请确认 papers bucket 已创建且为 Public。`
      }, { status: 500 });
    }

    const { data: texUrlData } = supabase.storage.from('papers').getPublicUrl(texPath);
    const texUrl = texUrlData.publicUrl;

    // 4. Return latexonline.cc URL — browser iframe will handle the long compilation
    const compileUrl = `https://latexonline.cc/compile?url=${encodeURIComponent(texUrl)}&command=pdflatex&force=true`;

    return NextResponse.json({
      pdfUrl: compileUrl,
      cached: false,
      texUrl,  // client can call /cache endpoint later to cache the PDF
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'PDF 生成失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
