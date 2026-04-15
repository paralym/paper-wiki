import { NextResponse } from 'next/server';
import { ArxivMeta } from '@/lib/arxiv';
import { extractKnowledge } from '@/lib/translate';
import { savePaper, updateConceptPage, updateEntityPage, updateIndex, appendLog } from '@/lib/wiki';

export async function POST(request: Request) {
  try {
    const { meta, translatedTex } = (await request.json()) as {
      meta: ArxivMeta;
      translatedTex: string;
    };

    if (!meta || !translatedTex) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const knowledge = await extractKnowledge(meta.title, meta.summary, translatedTex);
    const slug = await savePaper(meta, knowledge, translatedTex);

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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
