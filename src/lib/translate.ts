import OpenAI from 'openai';
import { TexChunk } from './arxiv';

export function getClient() {
  const base = process.env.OPENAI_BASE_URL || '';
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
  });
}

const MODEL = 'gemini-3-flash-preview';

const SYSTEM_PROMPT = `你是一位专业的学术论文翻译专家。你的任务是将英文 LaTeX 论文内容翻译为中文，并输出为 Markdown 格式。

转换规则：
1. 翻译所有自然语言文本为中文
2. 数学公式转为 Markdown 兼容格式：行内公式用 $...$，行间公式用 $$...$$
3. \\section{X} → ## X，\\subsection{X} → ### X，\\subsubsection{X} → #### X
4. \\textbf{X} → **X**，\\textit{X}/\\emph{X} → *X*
5. \\begin{itemize}/enumerate 转为 Markdown 列表（- 或 1.）
6. \\begin{abstract}...\\end{abstract} → ## 摘要 + 内容
7. \\cite{X} → [X]，\\ref{X} → [X]
8. 去掉 \\maketitle, \\label{}, \\noindent, \\newpage 等无关命令
9. figure/table 环境：保留 caption 文本翻译，其余去掉
10. 保持学术论文的正式语气
11. 直接输出 Markdown 内容，不要用代码块包裹，不要添加任何解释`;

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

export async function translateFullTex(sections: TexChunk[]): Promise<string> {
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
