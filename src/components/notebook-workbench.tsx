'use client';

import { useState } from 'react';

interface OrgOption {
  id: string;
  name: string;
  industry: string | null;
  findingsCount: number;
}

export function NotebookWorkbench({ organizations }: { organizations: OrgOption[] }) {
  const [selectedOrgId, setSelectedOrgId] = useState(organizations[0]?.id || '');
  const [customInstructions, setCustomInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    summary: string;
    audioScript: { hostA: string; hostB: string }[];
    slides: any[];
    pptxUrl: string;
  } | null>(null);

  async function handleGenerate() {
    if (!selectedOrgId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/notebook/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: selectedOrgId,
          customInstructions,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        alert(data.error || 'Failed to generate NotebookLM presentation');
      }
    } catch (err) {
      console.error(err);
      alert('Error connecting to NotebookLM service');
    } finally {
      setLoading(false);
    }
  }

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-r from-navy via-slate-900 to-navy p-6 text-white shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
              <span className="h-2 w-2 rounded-full bg-gold animate-ping" />
              NotebookLM & Gemini Intelligence Engine
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">Presentation & Strategic Document Generator</h1>
            <p className="mt-1 text-sm text-slate-300">
              Transform audit findings, evidence and lead data into executive presentation slide decks (.pptx), audio overview podcast scripts, and executive documents.
            </p>
          </div>
        </div>
      </div>

      {/* Controls Card */}
      <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text-primary">1. Select Target Prospect & Parameters</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Target Organization / Lead</label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background font-medium focus:border-blue-500 focus:outline-none"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.industry || 'General'}) — {org.findingsCount} verified findings
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted mb-1">Custom Presentation Focus / Prompt</label>
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g. Highlight quick wins, conversion rate improvement, and mobile UX"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background placeholder-muted-soft focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !selectedOrgId}
            className="flex items-center gap-2 rounded-xl bg-navy px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-navy/90 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <span>Synthesizing NotebookLM Deck...</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Generate Presentation & Documents</span>
              </>
            )}
          </button>

          {selectedOrgId && (
            <a
              href={`/api/notebook/pptx?orgId=${selectedOrgId}`}
              download
              className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-muted-bg transition-colors"
            >
              <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Download Direct PPTX</span>
            </a>
          )}
        </div>
      </div>

      {/* Generated Result Showcase */}
      {result && (
        <div className="space-y-6">
          {/* Action Bar */}
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-emerald-800 dark:text-emerald-300">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              NotebookLM Presentation & Artifacts Successfully Synthesized
            </div>
            <a
              href={result.pptxUrl}
              download
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-emerald-500 transition-colors"
            >
              📥 Download PowerPoint (.pptx)
            </a>
          </div>

          {/* Executive Summary */}
          <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Executive Summary</h3>
            <p className="mt-2 text-sm text-text-primary leading-relaxed">{result.summary}</p>
          </div>

          {/* Presentation Slide Deck Preview */}
          <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Generated Slide Deck Specification ({result.slides.length} Slides)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {result.slides.map((slide, idx) => (
                <div key={idx} className="rounded-xl border border-border bg-slate-900 p-4 text-white flex flex-col justify-between h-56">
                  <div>
                    <span className="text-[10px] font-semibold text-gold uppercase tracking-wider">Slide {idx + 1}</span>
                    <h4 className="mt-1 text-sm font-bold truncate text-white">{slide.title}</h4>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{slide.subtitle}</p>
                  </div>

                  <div className="space-y-1 mt-2">
                    {slide.cards?.map((c: any, cIdx: number) => (
                      <div key={cIdx} className="rounded bg-white/10 p-1.5 text-[11px]">
                        <span className="font-semibold text-blue-300">{c.title}</span>
                        <p className="text-[10px] text-slate-300 truncate">{c.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* NotebookLM Audio Podcast Overview Script */}
          <div className="rounded-xl border border-border-subtle bg-card p-6 shadow-sm space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted">NotebookLM Audio Overview Script</h3>
            <div className="space-y-3">
              {result.audioScript.map((script, idx) => (
                <div key={idx} className="space-y-2 rounded-lg bg-muted-bg p-3.5 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="rounded bg-blue-600 px-2 py-0.5 font-bold text-white shrink-0">Host A</span>
                    <p className="text-text-primary">{script.hostA}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="rounded bg-gold px-2 py-0.5 font-bold text-navy shrink-0">Host B</span>
                    <p className="text-text-primary">{script.hostB}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
