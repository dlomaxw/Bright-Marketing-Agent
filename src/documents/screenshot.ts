/**
 * Visual Website Screenshot & Audit Overlay Renderer
 * Generates visual mockup previews of target prospect websites with overlay badges
 * for identified audit issues (HTTP status, SSL, Mobile overflow, Noindex, Form errors).
 * Output format: base64 Data URIs and PNG/SVG Buffers for PPTX, DOCX, and PDF embedding.
 */

export interface AuditErrorHighlight {
  code: string;
  category: string;
  severity: string;
  label: string;
}

export interface ScreenshotOptions {
  domain: string;
  title: string;
  errors: AuditErrorHighlight[];
}

export function generateWebsiteScreenshotSvg(opts: ScreenshotOptions): string {
  const domain = opts.domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const title = opts.title.slice(0, 45);
  const errors = opts.errors.slice(0, 4);

  const errorBadgesSvg = errors
    .map((err, i) => {
      const y = 140 + i * 48;
      const color =
        err.severity === 'critical'
          ? '#EF4444'
          : err.severity === 'high'
          ? '#F97316'
          : err.severity === 'medium'
          ? '#EAB308'
          : '#3B82F6';

      return `
      <g transform="translate(40, ${y})">
        <rect x="0" y="0" width="480" height="38" rx="8" fill="#1E293B" stroke="${color}" stroke-width="1.5" />
        <circle cx="20" cy="19" r="6" fill="${color}" />
        <text x="36" y="23" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold" fill="#F8FAFC">
          [${err.severity.toUpperCase()}] ${err.code}
        </text>
        <text x="210" y="23" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#94A3B8">
          ${err.label.slice(0, 38)}
        </text>
      </g>
    `;
    })
    .join('');

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0F172A" />
        <stop offset="100%" stop-color="#1E293B" />
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.4" />
      </filter>
    </defs>

    <!-- Canvas Background -->
    <rect width="800" height="450" fill="url(#bg)" />

    <!-- Browser Window Frame -->
    <g filter="url(#shadow)">
      <rect x="25" y="25" width="750" height="400" rx="12" fill="#090D16" stroke="#334155" stroke-width="1.5" />
      
      <!-- Top Window Header Bar -->
      <rect x="25" y="25" width="750" height="36" rx="12" fill="#1E293B" />
      <rect x="25" y="49" width="750" height="12" fill="#1E293B" />

      <!-- Window Control Buttons -->
      <circle cx="45" cy="43" r="5" fill="#EF4444" />
      <circle cx="60" cy="43" r="5" fill="#F59E0B" />
      <circle cx="75" cy="43" r="5" fill="#10B981" />

      <!-- Address Bar -->
      <rect x="100" y="33" width="600" height="20" rx="6" fill="#0F172A" stroke="#475569" stroke-width="1" />
      <text x="110" y="47" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#38BDF8">
        https://${domain}
      </text>
    </g>

    <!-- Simulated Website Body Content -->
    <rect x="40" y="75" width="720" height="335" fill="#0F172A" rx="6" />

    <!-- Header & Hero Mockup -->
    <text x="60" y="110" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#F8FAFC">
      ${title || domain}
    </text>

    <!-- Visual Error Overlays Layer -->
    ${errorBadgesSvg}

    <!-- Watermark / Footer Badge -->
    <rect x="540" y="370" width="220" height="30" rx="6" fill="#1E293B" stroke="#D97706" stroke-width="1" />
    <text x="550" y="390" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="bold" fill="#F59E0B">
      BrightScope Audit Snapshot
    </text>
  </svg>
  `;
}

export function generateWebsiteScreenshotDataUrl(opts: ScreenshotOptions): string {
  const svg = generateWebsiteScreenshotSvg(opts);
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}
