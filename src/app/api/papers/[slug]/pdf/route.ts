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
      return NextResponse.json({ status: 'ready', pdfUrl: urlData.publicUrl });
    }

    // 2. If tex already uploaded, Action was triggered — just wait
    const texPath = `${slug}.tex`;
    const { data: texExists } = await supabase.storage
      .from('papers')
      .list('', { search: texPath });

    if (texExists && texExists.some(f => f.name === texPath)) {
      return NextResponse.json({
        status: 'compiling',
        message: 'PDF 正在编译中（GitHub Actions），请稍候...',
      });
    }

    // 3. Get paper from DB
    const { data: paper } = await supabase
      .from('papers')
      .select('content, arxiv_id')
      .eq('slug', slug)
      .single();

    if (!paper?.content) {
      return NextResponse.json({ error: '论文不存在或无内容' }, { status: 404 });
    }

    // 4. Upload the translated body content (NOT a standalone template)
    // GitHub Actions will merge this into the original source
    const texBlob = new Blob([paper.content], { type: 'text/plain' });
    const { error: uploadError } = await supabase.storage
      .from('papers')
      .upload(texPath, texBlob, { contentType: 'text/x-tex', upsert: true });

    if (uploadError) {
      return NextResponse.json({ error: `上传失败: ${uploadError.message}` }, { status: 500 });
    }

    // 5. Trigger GitHub Action
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken) {
      return NextResponse.json({ error: '缺少 GITHUB_TOKEN' }, { status: 500 });
    }

    const res = await fetch('https://api.github.com/repos/paralym/paper-wiki/dispatches', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        event_type: 'compile-pdf',
        client_payload: {
          slug,
          arxiv_id: paper.arxiv_id,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `触发编译失败: ${err}` }, { status: 500 });
    }

    return NextResponse.json({
      status: 'triggered',
      message: 'PDF 编译已触发，通常需要 2-3 分钟。页面会自动刷新。',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'PDF 生成失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
