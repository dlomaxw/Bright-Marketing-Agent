import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/server/auth/guard';
import { generateNotebookLMArtifacts } from '@/server/notebook/llm';

export async function GET(req: NextRequest) {
  try {
    await requirePermission('org.read');
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json({ error: 'orgId query parameter is required' }, { status: 400 });
    }

    const artifacts = await generateNotebookLMArtifacts({ organizationId: orgId });

    return new NextResponse(new Uint8Array(artifacts.pptxBuffer), {
      status: 200,
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'content-disposition': `attachment; filename="BrightScope_Presentation_${orgId}.pptx"`,
      },
    });
  } catch (err) {
    console.error('PPTX Export error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate presentation' },
      { status: 500 },
    );
  }
}
