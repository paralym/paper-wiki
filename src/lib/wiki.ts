import { supabase } from './supabase';
import { ArxivMeta } from './arxiv';
import { ExtractedKnowledge } from './translate';

export async function savePaper(
  meta: ArxivMeta,
  knowledge: ExtractedKnowledge,
  translatedTex: string
): Promise<string> {
  const slug = meta.arxivId.replace('.', '-');

  const { error } = await supabase.from('papers').upsert({
    slug,
    arxiv_id: meta.arxivId,
    title: knowledge.titleCn || meta.title,
    title_en: meta.title,
    authors: meta.authors,
    date: meta.published,
    categories: meta.categories,
    concepts: knowledge.concepts.map(c => c.name),
    entities: knowledge.entities.map(e => e.name),
    summary: knowledge.summary,
    mode: 'latex',
    content: translatedTex,
  }, { onConflict: 'slug' });

  if (error) throw new Error(`保存论文失败: ${error.message}`);
  return slug;
}

export async function savePaperHtml(
  meta: ArxivMeta,
  knowledge: ExtractedKnowledge,
  originalHtml: string,
  translatedHtml: string
): Promise<string> {
  const slug = meta.arxivId.replace('.', '-');

  const { error } = await supabase.from('papers').upsert({
    slug,
    arxiv_id: meta.arxivId,
    title: knowledge.titleCn || meta.title,
    title_en: meta.title,
    authors: meta.authors,
    date: meta.published,
    categories: meta.categories,
    concepts: knowledge.concepts.map(c => c.name),
    entities: knowledge.entities.map(e => e.name),
    summary: knowledge.summary,
    mode: 'html',
    original_html: originalHtml,
    translated_html: translatedHtml,
  }, { onConflict: 'slug' });

  if (error) throw new Error(`保存论文失败: ${error.message}`);
  return slug;
}

function cleanMarkdown(md: string): string {
  let out = md;
  out = out.replace(/\\begin\{document\}/g, '');
  out = out.replace(/\\end\{document\}/g, '');
  out = out.replace(/\\maketitle/g, '');
  out = out.replace(/\\tableofcontents/g, '');
  out = out.replace(/\\newpage/g, '');
  out = out.replace(/\\noindent\s*/g, '');
  out = out.replace(/\\label\{[^}]*\}/g, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

export async function updateConceptPage(
  concept: { name: string; description: string },
  arxivId: string
): Promise<void> {
  const slug = concept.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const { data: existing } = await supabase
    .from('concepts')
    .select('related_papers')
    .eq('slug', slug)
    .single();

  if (existing) {
    const papers = existing.related_papers || [];
    if (!papers.includes(arxivId)) {
      papers.push(arxivId);
      await supabase.from('concepts').update({ related_papers: papers }).eq('slug', slug);
    }
  } else {
    await supabase.from('concepts').insert({
      slug,
      title: concept.name,
      description: concept.description,
      related_papers: [arxivId],
    });
  }
}

export async function updateEntityPage(
  entity: { name: string; type: string; description: string },
  arxivId: string
): Promise<void> {
  const slug = entity.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const { data: existing } = await supabase
    .from('entities')
    .select('related_papers')
    .eq('slug', slug)
    .single();

  if (existing) {
    const papers = existing.related_papers || [];
    if (!papers.includes(arxivId)) {
      papers.push(arxivId);
      await supabase.from('entities').update({ related_papers: papers }).eq('slug', slug);
    }
  } else {
    await supabase.from('entities').insert({
      slug,
      title: entity.name,
      entity_type: entity.type,
      description: entity.description,
      related_papers: [arxivId],
    });
  }
}

export async function updateIndex(): Promise<void> {
  // No-op: index is now computed from DB queries, not a file
}

export async function appendLog(arxivId: string, title: string): Promise<void> {
  await supabase.from('logs').insert({
    arxiv_id: arxivId,
    title,
    action: 'ingest',
  });
}

export async function listPapers() {
  const { data } = await supabase
    .from('papers')
    .select('slug, title, title_en, arxiv_id, authors, date, categories, summary, mode')
    .order('created_at', { ascending: false });
  return (data || []).map(row => ({ slug: row.slug, data: row }));
}

export async function listConcepts() {
  const { data } = await supabase
    .from('concepts')
    .select('slug, title, related_papers')
    .order('title');
  return (data || []).map(row => ({ slug: row.slug, data: row }));
}

export async function listEntities() {
  const { data } = await supabase
    .from('entities')
    .select('slug, title, entity_type, related_papers')
    .order('title');
  return (data || []).map(row => ({ slug: row.slug, data: row }));
}

export async function getPaperContent(slug: string) {
  const { data, error } = await supabase
    .from('papers')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) throw new Error('论文未找到');

  if (data.mode === 'html') {
    return {
      data,
      content: '',
      mode: 'html' as const,
    };
  }
  return {
    data,
    content: data.content || '',
    mode: 'markdown' as const,
  };
}

export async function deletePaper(slug: string): Promise<{ arxivId: string; concepts: string[]; entities: string[] }> {
  const { data, error } = await supabase
    .from('papers')
    .select('arxiv_id, concepts, entities')
    .eq('slug', slug)
    .single();

  if (error || !data) throw new Error('论文未找到');

  const arxivId = data.arxiv_id;
  const concepts: string[] = data.concepts || [];
  const entities: string[] = data.entities || [];

  // Delete paper
  await supabase.from('papers').delete().eq('slug', slug);

  // Clean up concepts
  for (const name of concepts) {
    const cSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const { data: concept } = await supabase.from('concepts').select('related_papers').eq('slug', cSlug).single();
    if (concept) {
      const remaining = (concept.related_papers || []).filter((id: string) => id !== arxivId);
      if (remaining.length === 0) {
        await supabase.from('concepts').delete().eq('slug', cSlug);
      } else {
        await supabase.from('concepts').update({ related_papers: remaining }).eq('slug', cSlug);
      }
    }
  }

  // Clean up entities
  for (const name of entities) {
    const eSlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const { data: entity } = await supabase.from('entities').select('related_papers').eq('slug', eSlug).single();
    if (entity) {
      const remaining = (entity.related_papers || []).filter((id: string) => id !== arxivId);
      if (remaining.length === 0) {
        await supabase.from('entities').delete().eq('slug', eSlug);
      } else {
        await supabase.from('entities').update({ related_papers: remaining }).eq('slug', eSlug);
      }
    }
  }

  return { arxivId, concepts, entities };
}
