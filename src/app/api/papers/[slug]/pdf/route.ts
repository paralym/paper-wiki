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

    // 3. Wrap content in a standalone template that doesn't depend on conference style files
    const standaloneTex = buildStandaloneTex(paper.content);

    // 4. Upload LaTeX to Supabase Storage (fast, within 10s)
    const texPath = `${slug}.tex`;
    const texBlob = new Blob([standaloneTex], { type: 'text/plain' });
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

/**
 * Wrap translated LaTeX content in a standalone article template
 * that compiles without conference-specific style files.
 */
function buildStandaloneTex(translatedLatex: string): string {
  // Extract body content between \begin{document} and \end{document}
  const docBegin = translatedLatex.indexOf('\\begin{document}');
  const docEnd = translatedLatex.indexOf('\\end{document}');
  let body = translatedLatex;
  if (docBegin !== -1) {
    body = body.slice(docBegin + '\\begin{document}'.length);
    if (docEnd !== -1) {
      body = body.slice(0, body.indexOf('\\end{document}'));
    }
  }

  // Extract title if we can find it from common conference commands
  let title = '';
  const titleMatch = body.match(/\\(?:icmltitle|title|acltitle|nipstitle|neuripstitle)\s*\{([^}]*)\}/);
  if (titleMatch) title = titleMatch[1];

  // Extract authors
  const authors: string[] = [];
  const authorPattern = /\\(?:icmlauthor|author|aclauthor)\s*\{([^}]+)\}/g;
  let m;
  while ((m = authorPattern.exec(body)) !== null) {
    if (!authors.includes(m[1])) authors.push(m[1]);
  }

  // Strip conference-specific commands that don't exist in standard article class
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
    // Strip \input{} references to missing section files (we already inlined what we have)
    .replace(/\\input\s*\{[^}]+\}/g, '')
    // Strip bibliography commands since we don't have the .bib file
    .replace(/\\bibliography\s*\{[^}]+\}/g, '')
    .replace(/\\bibliographystyle\s*\{[^}]+\}/g, '')
    // Skip missing figures gracefully
    .replace(/\\includegraphics(\[[^\]]*\])?\{[^}]+\}/g, '\\fbox{\\texttt{[图片]}}');

  const authorsStr = authors.length > 0 ? authors.join(' \\and ') : '作者';

  return `\\documentclass[11pt]{article}
\\usepackage[UTF8]{ctex}
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
\\usepackage{subcaption}
\\usepackage{url}
\\usepackage{color}
\\usepackage{microtype}

\\title{${title || '论文翻译'}}
\\author{${authorsStr}}
\\date{}

\\begin{document}
\\maketitle

${body}

\\end{document}
`;
}

