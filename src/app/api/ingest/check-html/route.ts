import { NextResponse } from 'next/server';
import { checkHtmlAvailable } from '@/lib/arxiv-html';

export async function POST(request: Request) {
  try {
    const { arxivId } = await request.json();
    const result = await checkHtmlAvailable(arxivId);
    return NextResponse.json({ available: result.available });
  } catch {
    return NextResponse.json({ available: false });
  }
}
