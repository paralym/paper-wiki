import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const formData = await request.formData();
    const pdf = formData.get('pdf') as Blob;

    if (!pdf) {
      return NextResponse.json({ error: 'No PDF' }, { status: 400 });
    }

    const buffer = Buffer.from(await pdf.arrayBuffer());
    await supabase.storage.from('papers').upload(`${slug}.pdf`, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    return NextResponse.json({ cached: true });
  } catch {
    return NextResponse.json({ error: 'Cache failed' }, { status: 500 });
  }
}
