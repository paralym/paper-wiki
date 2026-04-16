import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // 1. Check if PDF is already cached in Supabase Storage
    const pdfPath = `${slug}.pdf`;
    const { data: existing } = await supabase.storage
      .from('papers')
      .list('', { search: pdfPath });

    if (existing && existing.some(f => f.name === pdfPath)) {
      // Return cached PDF URL
      const { data: urlData } = supabase.storage.from('papers').getPublicUrl(pdfPath);
      return NextResponse.json({ pdfUrl: urlData.publicUrl, cached: true });
    }

    // 2. Get the translated LaTeX from database
    const { data: paper } = await supabase
      .from('papers')
      .select('content, arxiv_id')
      .eq('slug', slug)
      .single();

    if (!paper || !paper.content) {
      return NextResponse.json({ error: '论文不存在或无内容' }, { status: 404 });
    }

    // 3. Upload LaTeX to Supabase Storage (public URL for latexonline.cc)
    const texPath = `${slug}.tex`;
    const texBlob = new Blob([paper.content], { type: 'text/plain' });
    await supabase.storage.from('papers').upload(texPath, texBlob, {
      contentType: 'text/x-tex',
      upsert: true,
    });

    const { data: texUrlData } = supabase.storage.from('papers').getPublicUrl(texPath);
    const texUrl = texUrlData.publicUrl;

    // 4. Call latexonline.cc to compile
    const compileUrl = `https://latexonline.cc/compile?url=${encodeURIComponent(texUrl)}&command=pdflatex&force=true`;
    const pdfRes = await fetch(compileUrl);

    if (!pdfRes.ok) {
      const errText = await pdfRes.text();
      return NextResponse.json({ error: `编译失败: ${errText.slice(0, 500)}` }, { status: 500 });
    }

    // 5. Upload PDF to Supabase Storage (cache it)
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    await supabase.storage.from('papers').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: pdfUrlData } = supabase.storage.from('papers').getPublicUrl(pdfPath);
    return NextResponse.json({ pdfUrl: pdfUrlData.publicUrl, cached: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'PDF 生成失败';
    console.error('PDF error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
