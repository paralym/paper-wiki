import { NextResponse } from 'next/server';
import { getFile, deleteFile, listDir, putFile } from '@/lib/github';
import matter from 'gray-matter';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // 1. Read the paper to get its arxiv_id, concepts, entities
    let arxivId = slug.replace('-', '.');
    let concepts: string[] = [];
    let entities: string[] = [];

    // Try JSON format first, then markdown
    const jsonFile = await getFile(`wiki/papers/${slug}.json`);
    if (jsonFile) {
      const data = JSON.parse(jsonFile.content);
      arxivId = data.arxiv_id || arxivId;
      concepts = data.concepts || [];
      entities = data.entities || [];
      await deleteFile(`wiki/papers/${slug}.json`, `delete paper: ${arxivId}`);
    } else {
      const mdFile = await getFile(`wiki/papers/${slug}.md`);
      if (mdFile) {
        const { data } = matter(mdFile.content);
        arxivId = data.arxiv_id || arxivId;
        concepts = data.concepts || [];
        entities = data.entities || [];
        await deleteFile(`wiki/papers/${slug}.md`, `delete paper: ${arxivId}`);
      } else {
        return NextResponse.json({ error: '论文未找到' }, { status: 404 });
      }
    }

    // 2. Delete cached HTML source if exists
    await deleteFile(`wiki/sources/${slug}-html.txt`, `delete source cache: ${arxivId}`);

    // 3. Clean up concept pages — remove this paper's reference
    for (const conceptName of concepts) {
      const conceptSlug = conceptName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const conceptPath = `wiki/concepts/${conceptSlug}.md`;
      const file = await getFile(conceptPath);
      if (!file) continue;

      const { data, content } = matter(file.content);
      if (data.related_papers) {
        data.related_papers = data.related_papers.filter((id: string) => id !== arxivId);
        if (data.related_papers.length === 0) {
          // No more papers reference this concept — delete it
          await deleteFile(conceptPath, `delete concept: ${conceptName}`);
        } else {
          await putFile(conceptPath, matter.stringify(content, data), `update concept: ${conceptName}`, file.sha);
        }
      }
    }

    // 4. Clean up entity pages
    for (const entityName of entities) {
      const entitySlug = entityName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const entityPath = `wiki/entities/${entitySlug}.md`;
      const file = await getFile(entityPath);
      if (!file) continue;

      const { data, content } = matter(file.content);
      if (data.related_papers) {
        data.related_papers = data.related_papers.filter((id: string) => id !== arxivId);
        if (data.related_papers.length === 0) {
          await deleteFile(entityPath, `delete entity: ${entityName}`);
        } else {
          await putFile(entityPath, matter.stringify(content, data), `update entity: ${entityName}`, file.sha);
        }
      }
    }

    // 5. Rebuild index
    const { updateIndex } = await import('@/lib/wiki');
    await updateIndex();

    return NextResponse.json({ success: true, deleted: arxivId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '删除失败';
    console.error('Delete error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
