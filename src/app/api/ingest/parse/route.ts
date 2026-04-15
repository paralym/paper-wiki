import { NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import { downloadAndExtract, collectTexFiles, resolveInputs } from '@/lib/arxiv';
import { getClient } from '@/lib/translate';

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description: 'List files in a directory. Pass empty string for root.',
      parameters: {
        type: 'object',
        properties: {
          subdir: { type: 'string', description: 'Subdirectory path, or empty string for root' },
        },
        required: ['subdir'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read first 40 lines of a file to inspect content',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to file' },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'select_main_file',
      description: 'Select the main paper .tex file. Call this when identified.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path to the main .tex file' },
          reason: { type: 'string', description: 'Why this is the main file' },
        },
        required: ['filePath', 'reason'],
      },
    },
  },
];

export async function POST(request: Request) {
  try {
    const { arxivId } = await request.json();
    if (!arxivId) {
      return NextResponse.json({ error: '缺少 arxivId' }, { status: 400 });
    }

    const { dir, singleFile } = await downloadAndExtract(arxivId);

    if (singleFile) {
      const chunks = splitIntoChunks(singleFile);
      return NextResponse.json({ chunks, totalChunks: chunks.length });
    }

    // Agent loop: let LLM explore and select the main file
    const client = getClient();
    let selectedPath: string | null = null;

    const messages: { role: string; content: string; tool_call_id?: string; name?: string }[] = [
      {
        role: 'system',
        content: `You are a LaTeX paper analyzer. Find the main paper file in an arXiv source package.

1. Call list_files with "" to see root directory
2. Call read_file on .tex files to check their content
3. Call select_main_file when you find the root paper file

Skip conference templates (iclr, neurips, icml formatting guides). The root file has \\begin{document} and usually \\input{} for sections.`,
      },
      { role: 'user', content: 'Find the main paper file in this arXiv source package.' },
    ];

    // Run up to 5 steps
    for (let step = 0; step < 5 && !selectedPath; step++) {
      const response = await client.chat.completions.create({
        model: 'gemini-3-flash-preview',
        messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
        tools: TOOLS,
      });

      const msg = response.choices[0]?.message;
      if (!msg) break;

      // Add assistant message
      messages.push({
        role: 'assistant',
        content: msg.content || '',
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } as Record<string, unknown> : {}),
      } as typeof messages[number]);

      // No tool calls = done
      if (!msg.tool_calls || msg.tool_calls.length === 0) break;

      // Execute tool calls
      for (const tc of msg.tool_calls) {
        const fn = tc as { id: string; function: { name: string; arguments: string } };
        const args = JSON.parse(fn.function.arguments);
        let result = '';

        if (fn.function.name === 'list_files') {
          const target = args.subdir ? path.join(dir, args.subdir) : dir;
          try {
            const entries = await fs.readdir(target, { withFileTypes: true });
            result = entries.map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).join('\n');
          } catch { result = 'Directory not found'; }
        } else if (fn.function.name === 'read_file') {
          try {
            const content = await fs.readFile(path.join(dir, args.filePath), 'utf-8');
            const lines = content.split('\n');
            result = `[${lines.length} lines, ${content.length} chars]\n${lines.slice(0, 40).join('\n')}`;
          } catch { result = 'File not found'; }
        } else if (fn.function.name === 'select_main_file') {
          selectedPath = args.filePath;
          result = `Selected: ${args.filePath}`;
        }

        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: fn.id,
        });
      }
    }

    // Read and resolve the selected file
    let fullContent: string;
    if (selectedPath) {
      const fullPath = path.join(dir, selectedPath);
      const content = await fs.readFile(fullPath, 'utf-8');
      fullContent = await resolveInputs(content, path.dirname(fullPath));
    } else {
      // Fallback
      const texFiles = await collectTexFiles(dir);
      const contents = await Promise.all(texFiles.map(async f => ({
        path: f, content: await fs.readFile(f, 'utf-8'),
      })));
      const best = contents
        .filter(f => f.content.includes('\\begin{document}'))
        .sort((a, b) => b.content.length - a.content.length)[0]
        || contents.sort((a, b) => b.content.length - a.content.length)[0];
      fullContent = await resolveInputs(best.content, path.dirname(best.path));
    }

    const chunks = splitIntoChunks(fullContent);
    return NextResponse.json({
      chunks,
      totalChunks: chunks.length,
      agent: selectedPath ? `Selected: ${selectedPath}` : 'fallback',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '解析失败';
    console.error('Parse error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function splitIntoChunks(tex: string) {
  const MAX_CHUNK = 12000;
  const chunks: { index: number; text: string; translatable: boolean }[] = [];

  const docBegin = tex.indexOf('\\begin{document}');
  const docEnd = tex.indexOf('\\end{document}');

  if (docBegin === -1) {
    chunks.push({ index: 0, text: tex, translatable: true });
    return chunks;
  }

  const body = tex.slice(docBegin + '\\begin{document}'.length, docEnd >= 0 ? docEnd : undefined);
  const sections = body.split(/(?=\\(?:section|chapter)\*?\{)/);

  for (const section of sections) {
    if (!section.trim()) continue;
    if (section.length <= MAX_CHUNK) {
      chunks.push({ index: chunks.length, text: section, translatable: true });
    } else {
      const paragraphs = section.split(/(\n\s*\n)/);
      let batch = '';
      for (const p of paragraphs) {
        if (batch.length + p.length > MAX_CHUNK && batch.trim()) {
          chunks.push({ index: chunks.length, text: batch, translatable: true });
          batch = p;
        } else {
          batch += p;
        }
      }
      if (batch.trim()) {
        chunks.push({ index: chunks.length, text: batch, translatable: true });
      }
    }
  }

  return chunks;
}
