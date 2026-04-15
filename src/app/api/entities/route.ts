import { NextResponse } from 'next/server';
import { listEntities } from '@/lib/wiki';

export const dynamic = 'force-dynamic';

export async function GET() {
  const entities = await listEntities();
  return NextResponse.json(entities);
}
