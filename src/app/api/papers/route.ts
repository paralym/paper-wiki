import { NextResponse } from 'next/server';
import { listPapers } from '@/lib/wiki';

export const dynamic = 'force-dynamic';

export async function GET() {
  const papers = await listPapers();
  return NextResponse.json(papers);
}
