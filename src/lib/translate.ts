import OpenAI from 'openai';
import { TexSection } from './arxiv';

function getClient() {
  const base = process.env.OPENAI_BASE_URL || '';
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
  });
}

const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `你是一位专业的学术论文翻译专家。你的任务是将英文 LaTeX 论文内容翻译为中文。

规则：
1. 只翻译自然语言文本，保留所有 LaTeX 命令和结构不变
2. 保留所有数学公式（$...$, $$...$$, \\[...\\] 等）不翻译
3. 保留 \\section, \\subsection 等命令，只翻译其参数中的文本
4. 保留 \\cite, \\ref, \\label 等引用命令不翻译
5. 严格按照术语表翻译专业术语，确保全文一致
6. 保持学术论文的正式语气
7. 直接输出翻译后的 LaTeX 内容，不要添加任何解释`;

export async function extractGlossary(abstractAndIntro: string): Promise<Record<string, string>> {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `从以下学术论文片段中提取所有专业术语，给出统一的中文翻译。

${abstractAndIntro}

以 JSON 格式返回，key 为英文术语，value 为中文翻译。例如：
{"attention mechanism": "注意力机制", "transformer": "Transformer", "fine-tuning": "微调"}

对于已成为通用名称的术语（如 Transformer, BERT, GPT）保留英文原文。
只返回 JSON，不要其他内容。`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || '{}';
  try {
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

export async function translateTexChunk(text: string, glossary?: Record<string, string>): Promise<string> {
  if (!text.trim()) return text;

  let glossaryNote = '';
  if (glossary && Object.keys(glossary).length > 0) {
    const entries = Object.entries(glossary).map(([en, zh]) => `${en} → ${zh}`).join('\n');
    glossaryNote = `\n\n【术语表，请严格遵循】\n${entries}`;
  }

  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 8192,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `请翻译以下 LaTeX 内容为中文：${glossaryNote}\n\n${text}` },
    ],
  });

  return response.choices[0]?.message?.content || text;
}

export async function translateFullTex(sections: TexSection[]): Promise<string> {
  const results: string[] = [];

  let currentBatch = '';
  const BATCH_SIZE = 3000;

  for (const section of sections) {
    if (!section.translatable) {
      if (currentBatch.trim()) {
        const translated = await translateTexChunk(currentBatch);
        results.push(translated);
        currentBatch = '';
      }
      results.push(section.content);
    } else {
      if (currentBatch.length + section.content.length > BATCH_SIZE && currentBatch.trim()) {
        const translated = await translateTexChunk(currentBatch);
        results.push(translated);
        currentBatch = section.content;
      } else {
        currentBatch += section.content;
      }
    }
  }

  if (currentBatch.trim()) {
    const translated = await translateTexChunk(currentBatch);
    results.push(translated);
  }

  return results.join('');
}

export interface ExtractedKnowledge {
  concepts: { name: string; description: string }[];
  entities: { name: string; type: 'person' | 'organization' | 'model' | 'dataset'; description: string }[];
  summary: string;
  titleCn: string;
}

export async function extractKnowledge(
  title: string,
  abstract: string,
  translatedContent: string
): Promise<ExtractedKnowledge> {
  const response = await getClient().chat.completions.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `分析以下学术论文，提取关键概念和实体。

标题: ${title}
摘要: ${abstract}
内容片段: ${translatedContent.slice(0, 5000)}

请以 JSON 格式返回：
{
  "titleCn": "论文中文标题",
  "summary": "一句话中文摘要（50字以内）",
  "concepts": [
    {"name": "概念英文名", "description": "概念的简短中文描述"}
  ],
  "entities": [
    {"name": "实体名", "type": "person|organization|model|dataset", "description": "简短描述"}
  ]
}

只返回 JSON，不要其他内容。`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || '';
  try {
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  } catch {
    return { concepts: [], entities: [], summary: '', titleCn: title };
  }
}
