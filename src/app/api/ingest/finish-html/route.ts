import { NextResponse } from 'next/server';
import { buildBilingualHtml } from '@/lib/arxiv-html';
import { ArxivMeta } from '@/lib/arxiv';
import { extractKnowledge } from '@/lib/translate';
import { getFile, putFile } from '@/lib/github';
import { updateConceptPage, updateEntityPage, updateIndex, appendLog } from '@/lib/wiki';

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

    // Load cached HTML
    const cachePath = `wiki/sources/${slug}-html.txt`;
    const cached = await getFile(cachePath);
    if (!cached) {
      return NextResponse.json({ error: '未找到缓存的 HTML' }, { status: 404 });
    }

    // Build translation map
    const translationMap = new Map<string, string>();
    for (const t of translations) {
      translationMap.set(t.id, t.text);
    }

    // Build bilingual HTML
    const { originalHtml, translatedHtml } = buildBilingualHtml(cached.content, translationMap);

    // Extract knowledge from translated text
    const allTranslatedText = translations.map(t => t.text).join('\n');
    const knowledge = await extractKnowledge(meta.title, meta.summary, allTranslatedText);

    // Save paper as JSON with both HTML versions
    const paperData = {
      title: knowledge.titleCn || meta.title,
      title_en: meta.title,
      arxiv_id: meta.arxivId,
      authors: meta.authors,
      date: meta.published,
      categories: meta.categories,
      concepts: knowledge.concepts.map(c => c.name),
      entities: knowledge.entities.map(e => e.name),
      summary: knowledge.summary,
      mode: 'html',
      originalHtml,
      translatedHtml,
    };

    const paperPath = `wiki/papers/${slug}.json`;
    const existingPaper = await getFile(paperPath);
    await putFile(paperPath, JSON.stringify(paperData, null, 2), `add paper: ${meta.arxivId}`, existingPaper?.sha);

    // Update concepts, entities, index, log
    for (const concept of knowledge.concepts) {
      await updateConceptPage(concept, meta.arxivId);
    }
    for (const entity of knowledge.entities) {
      await updateEntityPage(entity, meta.arxivId);
    }
    await updateIndex();
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
