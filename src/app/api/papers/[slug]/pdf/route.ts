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
      const { data: urlData } = supabase.storage.from('papers').getPublicUrl(pdfPath);
      return NextResponse.json({ status: 'ready', pdfUrl: urlData.publicUrl });
    }

    // 2. Check if compilation is already triggered (tex file exists = in progress)
    const texPath = `${slug}.tex`;
    const { data: texExists } = await supabase.storage
      .from('papers')
      .list('', { search: texPath });

    if (texExists && texExists.some(f => f.name === texPath)) {
      return NextResponse.json({ status: 'compiling', message: 'PDF 正在编译中，请稍候刷新...' });
    }

    // 3. Get LaTeX from DB
    const { data: paper } = await supabase
      .from('papers')
      .select('content')
      .eq('slug', slug)
      .single();

    if (!paper?.content) {
      return NextResponse.json({ error: '论文不存在或无内容' }, { status: 404 });
    }

    // 4. Build standalone LaTeX and upload to Supabase
    const standaloneTex = buildStandaloneTex(paper.content);
    const texBlob = new Blob([standaloneTex], { type: 'text/plain' });
    const { error: uploadError } = await supabase.storage
      .from('papers')
      .upload(texPath, texBlob, { contentType: 'text/x-tex', upsert: true });

    if (uploadError) {
      return NextResponse.json({ error: `上传失败: ${uploadError.message}` }, { status: 500 });
    }

    // 5. Trigger GitHub Action to compile
    const ghToken = process.env.GITHUB_TOKEN;
    if (ghToken) {
      await fetch('https://api.github.com/repos/paralym/paper-wiki/dispatches', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: 'compile-pdf',
          client_payload: { slug },
        }),
      });
    }

    return NextResponse.json({
      status: 'triggered',
      message: 'PDF 编译已触发，通常需要 1-2 分钟。请稍后刷新页面。',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'PDF 生成失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildStandaloneTex(translatedLatex: string): string {
  let body = translatedLatex;
  const docBegin = body.indexOf('\\begin{document}');
  const docEnd = body.indexOf('\\end{document}');
  if (docBegin !== -1) {
    body = body.slice(docBegin + '\\begin{document}'.length);
    if (docEnd !== -1) {
      body = body.slice(0, body.indexOf('\\end{document}'));
    }
  }

  // Extract title
  let title = '论文翻译';
  const titleMatch = body.match(/\\(?:icmltitle|title|acltitle)\s*\{([^}]*)\}/);
  if (titleMatch) title = titleMatch[1];

  // Extract authors
  const authors: string[] = [];
  const authorPattern = /\\(?:icmlauthor|author)\s*\{([^}]+)\}/g;
  let m;
  while ((m = authorPattern.exec(body)) !== null) {
    if (!authors.includes(m[1])) authors.push(m[1]);
  }

  // Strip conference-specific commands
  body = body
    .replace(/\\icmltitle\s*\{[^}]*\}/g, '')
    .replace(/\\icmlauthor\s*\{[^}]+\}\s*\{[^}]+\}/g, '')
    .replace(/\\icmlaffiliation\s*\{[^}]+\}\s*\{[^}]*\}/g, '')
    .replace(/\\icmlcorrespondingauthor\s*\{[^}]+\}\s*\{[^}]*\}/g, '')
    .replace(/\\icmlkeywords\s*\{[^}]*\}/g, '')
    .replace(/\\icmlsetsymbol\s*\{[^}]+\}\s*\{[^}]*\}/g, '')
    .replace(/\\begin\{icmlauthorlist\}[\s\S]*?\\end\{icmlauthorlist\}/g, '')
    .replace(/\\printAffiliationsAndNotice\s*\{[^}]*\}/g, '')
    .replace(/\\aclfinalcopy/g, '')
    .replace(/\\iclrfinalcopy/g, '')
    .replace(/\\ifcolmsubmission[\s\S]*?\\fi/g, '')
    .replace(/\\linenumbers/g, '')
    .replace(/\\maketitle/g, '')
    .replace(/\\input\s*\{[^}]+\}/g, '')
    .replace(/\\bibliography\s*\{[^}]+\}/g, '')
    .replace(/\\bibliographystyle\s*\{[^}]+\}/g, '')
    .replace(/\\includegraphics(\[[^\]]*\])?\{[^}]+\}/g, '\\fbox{[图片]}');

  return `\\documentclass[11pt,a4paper]{article}
\\usepackage{xeCJK}
\\setCJKmainfont{Noto Serif CJK SC}
\\setCJKsansfont{Noto Sans CJK SC}
\\setCJKmonofont{Noto Sans Mono CJK SC}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{float}
\\usepackage{xcolor}
\\usepackage{enumitem}
\\usepackage{caption}
\\usepackage{url}
\\usepackage{microtype}

\\title{${title}}
\\author{${authors.length > 0 ? authors.join(' \\\\and ') : ''}}
\\date{}

\\begin{document}
\\maketitle

${body}

\\end{document}
`;
}
