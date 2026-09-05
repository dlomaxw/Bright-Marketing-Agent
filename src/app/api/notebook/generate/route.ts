import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/server/auth/guard';
import { generateNotebookLMArtifacts } from '@/server/notebook/llm';

export async function POST(req: NextRequest) {
  try {
    await requirePermission('org.read');
    const body = await req.json();
    const { organizationId, customInstructions } = body;

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
    }

    const artifacts = await generateNotebookLMArtifacts({
      organizationId,
      customInstructions,
    });

    return NextResponse.json({
      summary: artifacts.summary,
      audioScript: artifacts.audioScript,
      slides: artifacts.presentationSlides,
      pptxUrl: `/api/notebook/pptx?orgId=${organizationId}`,
    });
  } catch (err) {
    console.error('NotebookLM generate error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to process NotebookLM request' },
      { status: 500 },
    );
  }
}
