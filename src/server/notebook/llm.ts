import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { generatePptx, type PresentationMeta, type PresentationSlide } from '@/documents/pptx';
import { renderDocx } from '@/documents/docx';
import { renderPdf } from '@/documents/pdf';

export interface NotebookLMRequest {
  organizationId: string;
  customInstructions?: string;
}

export interface NotebookLMResult {
  summary: string;
  audioScript: {
    hostA: string;
    hostB: string;
  }[];
  presentationSlides: PresentationSlide[];
  docxBuffer: Buffer;
  pdfBuffer: Buffer;
  pptxBuffer: Buffer;
}

export async function generateNotebookLMArtifacts(
  req: NotebookLMRequest,
): Promise<NotebookLMResult> {
  const org = await db.organization.findUnique({
    where: { id: req.organizationId },
    include: {
      findings: { where: { verificationStatus: 'manually_verified' } },
      contacts: true,
      reports: { take: 1, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!org) {
    throw new Error('Organization not found.');
  }

  const verifiedFindings = org.findings;
  const topCategories = [...new Set(verifiedFindings.map((f) => f.category))];

  // 1. Synthesize NotebookLM Executive Presentation & Audio Overview via Gemini API
  const prompt = `You are a NotebookLM strategic intelligence assistant for Bright Thoughts Services.
Generate a structured executive presentation & audio overview script for prospect: "${org.legalName}".
Industry: ${org.industry || 'Business Services'}. Website: ${org.website || 'N/A'}.
Verified Audit Findings (${verifiedFindings.length}):
${JSON.stringify(
  verifiedFindings.map((f) => ({
    checkCode: f.checkCode,
    category: f.category,
    severity: f.severity,
    observation: f.observation_text,
    recommendation: f.recommendation,
  })),
  null,
  2,
)}

Custom Instructions: ${req.customInstructions || 'Focus on digital growth, quick wins, and conversion improvements.'}

Respond strictly in valid JSON with this exact schema:
{
  "summary": "Executive overview paragraph summarizing key findings and growth potential...",
  "audioScript": [
    { "hostA": "Host 1 dialogue line...", "hostB": "Host 2 dialogue line..." }
  ],
  "slides": [
    {
      "title": "Slide Title",
      "subtitle": "Slide Subtitle",
      "cards": [
        { "title": "Card 1 Title", "body": "Card 1 Body description...", "badge": "Quick Win" }
      ]
    }
  ]
}`;

  let summary = `Executive Audit & Strategic Overview for ${org.legalName}.`;
  let audioScript = [
    {
      hostA: `Welcome to the NotebookLM deep dive for ${org.legalName}. Today we are breaking down their digital marketing audit.`,
      hostB: `That's right. Our automated scan and human verification uncovered key opportunities in ${topCategories.join(', ') || 'digital presence'}.`,
    },
  ];
  let slides: PresentationSlide[] = [];

  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY;
  if (apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      });

      if (res.ok) {
        const payload = (await res.json()) as any;
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const parsed = JSON.parse(text);
        if (parsed.summary) summary = parsed.summary;
        if (parsed.audioScript) audioScript = parsed.audioScript;
        if (parsed.slides) slides = parsed.slides;
      }
    } catch (err) {
      console.warn('NotebookLM Gemini generation fallback:', err);
    }
  }

  // Fallback Slides if model output is missing or offline
  if (!slides || slides.length === 0) {
    slides = [
      {
        title: 'Executive Summary',
        subtitle: `Digital Audit Assessment for ${org.legalName}`,
        cards: [
          {
            title: 'Verified Audit Score',
            body: `${verifiedFindings.length} verified observations recorded across ${topCategories.length} key digital channels.`,
            badge: 'Audit Overview',
          },
          {
            title: 'Primary Focus Areas',
            body: topCategories.length
              ? `Main opportunities identified in ${topCategories.slice(0, 3).join(', ')}.`
              : 'Website performance, mobile responsiveness and technical SEO.',
            badge: 'Impact Analysis',
          },
          {
            title: 'Strategic Recommendation',
            body: 'Implement fixed-scope Phase 1 optimizations to stabilize user engagement and lead capture.',
            badge: 'Action Plan',
          },
        ],
      },
      {
        title: 'Verified Findings Breakdown',
        subtitle: 'Evidence-backed issues ready for resolution',
        cards: verifiedFindings.slice(0, 3).map((f) => ({
          title: f.checkCode,
          body: `${f.observation_text || 'Observation recorded.'}\n\nRecommendation: ${f.recommendation || 'Remediate issue.'}`,
          badge: f.severity.toUpperCase(),
        })),
      },
      {
        title: 'Growth & Implementation Roadmap',
        subtitle: 'Phased rollout plan for Bright Thoughts Services',
        cards: [
          {
            title: 'Phase 1: Quick Wins (0-30 Days)',
            body: 'Fix critical availability, HTTPS security, and core contact forms.',
            badge: 'Immediate',
          },
          {
            title: 'Phase 2: Conversion (30-60 Days)',
            body: 'Optimize page speed, mobile layouts, and clear calls-to-action.',
            badge: 'Medium Term',
          },
          {
            title: 'Phase 3: Scale (60-90 Days)',
            body: 'Deploy targeted SEO campaigns, local signals, and social integration.',
            badge: 'Growth Phase',
          },
        ],
      },
    ];
  }

  const meta: PresentationMeta = {
    title: 'Marketing Audit & Strategic Growth Deck',
    organization: org.legalName,
    date: new Date().toISOString().slice(0, 10),
    preparedBy: 'BrightScope Notebook LLM Intelligence',
    version: 1,
  };

  // Generate Presentations and Documents
  const pptxBuffer = await generatePptx(meta, slides);

  const docSections = [
    {
      heading: 'Executive Summary',
      body: summary,
    },
    {
      heading: 'NotebookLM Audio Overview Script',
      body: audioScript
        .map((s) => `**Host A:** ${s.hostA}\n\n**Host B:** ${s.hostB}`)
        .join('\n\n---\n\n'),
    },
    {
      heading: 'Verified Audit Findings & Recommendations',
      body: verifiedFindings
        .map(
          (f) =>
            `### [${f.severity.toUpperCase()}] ${f.checkCode}\n- **Observation:** ${f.observation_text}\n- **Recommendation:** ${f.recommendation}`,
        )
        .join('\n\n'),
    },
  ];

  const docxMeta = {
    title: 'NotebookLM Strategic Audit Brief',
    organization: org.legalName,
    version: 1,
    status: 'Approved',
    preparedBy: 'BrightScope AI Assistant',
    date: new Date(),
  };

  const docxBuffer = await renderDocx(docxMeta, docSections);
  const pdfBuffer = await renderPdf(docxMeta, docSections);

  return {
    summary,
    audioScript,
    presentationSlides: slides,
    pptxBuffer,
    docxBuffer,
    pdfBuffer,
  };
}
