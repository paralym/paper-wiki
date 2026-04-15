import { NextResponse } from 'next/server';
import { buildBilingualHtml } from '@/lib/arxiv-html';
import { ArxivMeta } from '@/lib/arxiv';
import { extractKnowledge } from '@/lib/translate';
import { savePaperHtml, updateConceptPage, updateEntityPage, appendLog } from '@/lib/wiki';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { meta, translations } = (await request.json()) as {
      meta: ArxivMeta;
      translations: { id: string; text: string }[];
    };

    if (!meta || !translations) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const slug = meta.arxivId.replace('.', '-');

    // Load cached HTML from Supabase
    const { data: cached } = await supabase
      .from('html_cache')
      .select('html')
      .eq('slug', slug)
      .single();

    if (!cached) {
      return NextResponse.json({ error: '未找到缓存的 HTML' }, { status: 404 });
    }

    const translationMap = new Map<string, string>();
    for (const t of translations) {
      translationMap.set(t.id, t.text);
    }

    const { originalHtml, translatedHtml } = buildBilingualHtml(cached.html, translationMap);

    const allTranslatedText = translations.map(t => t.text).join('\n');
    const knowledge = await extractKnowledge(meta.title, meta.summary, allTranslatedText);

    await savePaperHtml(meta, knowledge, originalHtml, translatedHtml);

    for (const concept of knowledge.concepts) {
      await updateConceptPage(concept, meta.arxivId);
    }
    for (const entity of knowledge.entities) {
      await updateEntityPage(entity, meta.arxivId);
    }
    await appendLog(meta.arxivId, knowledge.titleCn || meta.title);

    return NextResponse.json({
      success: true,
      slug,
      title: knowledge.titleCn || meta.title,
      concepts: knowledge.concepts.length,
      entities: knowledge.entities.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '保存失败';
    console.error('Finish-html error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
