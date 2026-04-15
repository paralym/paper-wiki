import { NextResponse } from 'next/server';
import { listConcepts } from '@/lib/wiki';

export const dynamic = 'force-dynamic';

export async function GET() {
  const concepts = await listConcepts();
  return NextResponse.json(concepts);
}
