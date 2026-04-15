import { NextResponse } from 'next/server';
import { parseArxivId, fetchArxivMeta, downloadLatexSource, parseTexForTranslation } from '@/lib/arxiv';
import { translateFullTex, extractKnowledge } from '@/lib/translate';
import { savePaper, updateConceptPage, updateEntityPage, updateIndex, appendLog } from '@/lib/wiki';

export const maxDuration = 300; // 5 minutes for Vercel

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: '请提供 arXiv 链接' }, { status: 400 });
    }

    const arxivId = parseArxivId(url);

    // Step 1: Fetch metadata
    const meta = await fetchArxivMeta(arxivId);

    // Step 2: Download LaTeX source
    const texSource = await downloadLatexSource(arxivId);

    // Step 3: Parse and translate
    const sections = parseTexForTranslation(texSource);
    const translatedTex = await translateFullTex(sections);

    // Step 4: Extract knowledge (concepts, entities)
    const knowledge = await extractKnowledge(meta.title, meta.summary, translatedTex);

    // Step 5: Save paper
    const slug = await savePaper(meta, knowledge, translatedTex);

    // Step 6: Update concept and entity pages
    for (const concept of knowledge.concepts) {
      await updateConceptPage(concept, meta.arxivId);
    }
    for (const entity of knowledge.entities) {
      await updateEntityPage(entity, meta.arxivId);
    }

    // Step 7: Update index and log
    await updateIndex();
    await appendLog(meta.arxivId, knowledge.titleCn || meta.title);

    return NextResponse.json({
      success: true,
      slug,
      title: knowledge.titleCn || meta.title,
      arxivId: meta.arxivId,
      concepts: knowledge.concepts.length,
      entities: knowledge.entities.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('Ingest error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
