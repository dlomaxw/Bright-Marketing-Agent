/**
 * Service catalogue, from Appendix A of the product documentation plus the
 * service modules named in the brief.
 *
 * `amount` is deliberately absent. No price was invented; an administrator
 * enters the price book in Settings before the first proposal
 * (docs/ASSUMPTIONS.md 2).
 *
 * `triggerCategories` / `triggerCheckCodes` implement the finding-to-service
 * mapping in section 10 of the documentation, and are what makes every proposal
 * line traceable to the evidence that justifies it.
 *
 * Several modules deliberately carry no triggers. A website audit cannot
 * produce evidence that a developer needs an architectural render, so those
 * services are added to a proposal by a person who knows the client, rather
 * than attached automatically. Wiring a trigger that does not follow from the
 * evidence would make a recommendation look earned when it was not — which is
 * the one thing this catalogue exists to prevent.
 */
export interface ServiceSeed {
  code: string;
  name: string;
  family: string;
  summary: string;
  deliverables: string[];
  defaultPhase: 'phase_1' | 'phase_2' | 'phase_3';
  triggerCategories: string[];
  triggerCheckCodes: string[];
  sortOrder: number;
}

export const SERVICE_MODULES: ServiceSeed[] = [
  {
    code: 'rapid_website_launch',
    name: 'Complete website development',
    family: 'Web',
    summary:
      'Discovery, sitemap, responsive build, forms, WhatsApp and call paths, analytics and launch.',
    deliverables: [
      'Discovery session and requirements summary',
      'Sitemap and page structure',
      'Responsive design for phone, tablet and desktop',
      'Five to ten content pages built and populated',
      'Enquiry form routed to a monitored inbox',
      'Click-to-call and WhatsApp contact paths',
      'Analytics and conversion event setup',
      'Launch, redirects and post-launch checks',
    ],
    defaultPhase: 'phase_1',
    triggerCategories: ['availability'],
    triggerCheckCodes: ['page.holding', 'page.parked', 'dir.index', 'dns.resolves', 'http.status', 'page.empty'],
    sortOrder: 10,
  },
  {
    code: 'website_redesign',
    name: 'Website redesign',
    family: 'Web',
    summary:
      'User experience, visual design, content migration, CMS, accessibility, redirects and QA.',
    deliverables: [
      'UX review and revised page structure',
      'Visual design aligned to the brand',
      'Content migration and rewriting where needed',
      'CMS implementation and editor training',
      'Accessibility improvements',
      'Redirect map and search-visibility protection',
      'Cross-device quality assurance',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: ['mobile'],
    triggerCheckCodes: ['viewport.missing', 'viewport.fixed_width'],
    sortOrder: 20,
  },
  {
    code: 'wordpress_care',
    name: 'WordPress maintenance and care',
    family: 'Web',
    summary: 'Updates, backups, monitoring, content cleanup, staging, performance and governance.',
    deliverables: [
      'Scheduled core, theme and plugin updates',
      'Automated backups with a tested restore',
      'Uptime and error monitoring',
      'Removal of default and demo content',
      'Staging environment with access control',
      'Monthly maintenance report',
    ],
    defaultPhase: 'phase_1',
    triggerCategories: ['cms'],
    triggerCheckCodes: ['wp.default_pages', 'wp.hello_world', 'wp.readme', 'copyright.stale', 'link.internal_broken'],
    sortOrder: 30,
  },
  {
    code: 'hosting_remediation',
    name: 'Hosting remediation and deployment',
    family: 'Web',
    summary: 'Hosting cleanup, deployment configuration, HTTPS, redirects and monitoring.',
    deliverables: [
      'Hosting and DNS review',
      'HTTPS certificate installation and site-wide redirect',
      'Directory listing and deployment residue removed',
      'Redirect chain cleanup',
      'Staging site restricted from public access and search engines',
      'Uptime monitoring and alerting',
    ],
    defaultPhase: 'phase_1',
    triggerCategories: [],
    triggerCheckCodes: [
      'https.available', 'https.redirect', 'dir.index', 'redirect.chain', 'redirect.loop',
      'staging.public', 'http.reachable',
    ],
    sortOrder: 40,
  },
  {
    code: 'technical_seo',
    name: 'Technical SEO implementation',
    family: 'Search',
    summary: 'Titles, metadata, headings, canonicals, robots, sitemap, schema and Search Console.',
    deliverables: [
      'Page titles and meta descriptions for the main pages',
      'Heading structure corrections',
      'Canonical tags and indexability review',
      'robots.txt and XML sitemap published',
      'Structured data implementation',
      'Search Console setup and baseline report',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: ['seo'],
    triggerCheckCodes: [],
    sortOrder: 50,
  },
  {
    code: 'local_seo',
    name: 'Local SEO and Google Business optimisation',
    family: 'Search',
    summary:
      'Google Business Profile, name/address/phone consistency, citations, reviews and local pages.',
    deliverables: [
      'Google Business Profile completion and verification',
      'Category, hours, service areas and photos',
      'Consistent name, address and telephone across the site and directories',
      'LocalBusiness structured data',
      'Review request and response workflow',
      'Local landing pages where relevant',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: ['local'],
    triggerCheckCodes: [],
    sortOrder: 60,
  },
  {
    code: 'content',
    name: 'Content strategy',
    family: 'Content',
    summary: 'Positioning, information architecture, service pages and an editorial plan.',
    deliverables: [
      'Positioning and message summary',
      'Information architecture and page plan',
      'Service page outlines',
      'Editorial calendar',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: ['content'],
    triggerCheckCodes: [],
    sortOrder: 70,
  },
  {
    code: 'copywriting',
    name: 'Copywriting',
    family: 'Content',
    summary: 'Writing and rewriting of home, service, about and landing page content.',
    deliverables: [
      'Home page copy',
      'Service page copy',
      'Company background copy',
      'Two rounds of revision per page',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: ['content.lorem', 'content.demo', 'page.thin', 'services.missing', 'about.missing'],
    sortOrder: 80,
  },
  {
    code: 'performance_images',
    name: 'Performance and image optimisation',
    family: 'Web',
    summary: 'Image resizing and modern formats, lazy loading, asset loading and a performance budget.',
    deliverables: [
      'Image audit, resizing and compression',
      'Modern format delivery with fallbacks',
      'Lazy loading below the first screen',
      'Render-blocking asset review',
      'Performance budget and before/after measurement',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: ['performance'],
    triggerCheckCodes: [],
    sortOrder: 90,
  },
  {
    code: 'accessibility',
    name: 'Accessibility improvements',
    family: 'Web',
    summary: 'Alt text, form labels, link text, language, heading order and keyboard basics.',
    deliverables: [
      'Alt text for meaningful images',
      'Labels associated with every form field',
      'Descriptive link text',
      'Heading order corrections',
      'Keyboard navigation and focus visibility review',
    ],
    defaultPhase: 'phase_3',
    triggerCategories: ['accessibility'],
    triggerCheckCodes: [],
    sortOrder: 100,
  },
  {
    code: 'conversion_crm',
    name: 'Conversion optimisation and CRM',
    family: 'Growth',
    summary: 'Forms, call and WhatsApp tracking, lead routing, CRM stages and dashboards.',
    deliverables: [
      'Enquiry forms with validation and delivery testing',
      'Click-to-call and WhatsApp paths',
      'Lead routing to a monitored inbox or CRM',
      'CRM pipeline stages and ownership',
      'Enquiry source tracking',
    ],
    defaultPhase: 'phase_1',
    triggerCategories: ['conversion'],
    triggerCheckCodes: [],
    sortOrder: 110,
  },
  {
    code: 'digital_measurement',
    name: 'Analytics and tracking',
    family: 'Growth',
    summary: 'Analytics, tags, conversion events, dashboards and monthly reporting.',
    deliverables: [
      'Analytics installation and configuration',
      'Conversion events for enquiries, calls and WhatsApp',
      'Dashboard covering traffic, enquiries and sources',
      'Monthly report with commentary',
    ],
    defaultPhase: 'phase_1',
    triggerCategories: [],
    triggerCheckCodes: ['analytics.tag_present', 'analytics.events_declared'],
    sortOrder: 120,
  },
  {
    code: 'social_setup',
    name: 'Social media setup',
    family: 'Social',
    summary: 'Profile optimisation, branding, links, calls to action and platform strategy.',
    deliverables: [
      'Profile completion across the agreed platforms',
      'Consistent branding, description and links',
      'Call-to-action configuration',
      'Platform strategy summary',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: ['social'],
    triggerCheckCodes: [],
    sortOrder: 130,
  },
  {
    code: 'social_management',
    name: 'Social media management',
    family: 'Social',
    summary: 'Content calendar, production, publishing, community response and reporting.',
    deliverables: [
      'Monthly content calendar',
      'Content production and scheduling',
      'Community response workflow',
      'Monthly performance report',
    ],
    defaultPhase: 'phase_3',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 140,
  },
  {
    code: 'content_production',
    name: 'Content production',
    family: 'Content',
    summary: 'Photography, video and graphics produced for the website and social channels.',
    deliverables: ['Shot list and production plan', 'Photography or video shoot', 'Edited assets delivered'],
    defaultPhase: 'phase_3',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 150,
  },
  {
    code: 'paid_advertising',
    name: 'Paid advertising',
    family: 'Growth',
    summary: 'Campaign structure, creative, landing pages, tracking and optimisation.',
    deliverables: ['Campaign structure and targeting', 'Ad creative', 'Landing page alignment', 'Conversion tracking', 'Optimisation and reporting'],
    defaultPhase: 'phase_3',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 160,
  },
  {
    code: 'monthly_reporting',
    name: 'Monthly reporting',
    family: 'Growth',
    summary: 'Consolidated monthly reporting across website, search, social and enquiries.',
    deliverables: ['Monthly dashboard', 'Written commentary and recommended actions', 'Review call'],
    defaultPhase: 'phase_3',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 170,
  },
// --- Custom platform ------------------------------------------------------
  // Bright Thoughts' own build, offered where the audit shows the third-party
  // platform is the problem rather than one of its symptoms.
  {
    code: 'custom_platform_build',
    name: 'Custom website platform',
    family: 'Platform',
    summary:
      'A website built for the business rather than assembled from a template, with the content model, enquiry flow and admin designed around how it actually sells.',
    deliverables: [
      'Discovery: how enquiries arrive today and where they are lost',
      'Content model built around the services actually sold',
      'Responsive build with no template residue to clean up later',
      'Enquiry capture designed in, not bolted on',
      'Analytics and conversion events from day one',
      'Launch, redirects from the old site, and post-launch checks',
    ],
    defaultPhase: 'phase_1',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 5,
  },
  {
    code: 'platform_migration',
    name: 'Migration from a third-party platform',
    family: 'Platform',
    summary:
      'Moving a site off WordPress or a hosted website builder without losing search visibility or content.',
    deliverables: [
      'Content inventory and what to keep, rewrite or retire',
      'URL map and redirects so existing search rankings are preserved',
      'Data export from the current platform',
      'Parallel running and cutover plan',
      'Search Console monitoring through the transition',
      'Decommissioning the old platform and its subscriptions',
    ],
    defaultPhase: 'phase_1',
    triggerCategories: [],
    triggerCheckCodes: ['staging.public'],
    sortOrder: 6,
  },
  {
    code: 'custom_crm',
    name: 'Custom CRM',
    family: 'Platform',
    summary:
      'A CRM shaped to the way the business already works, rather than a generic tool it has to work around.',
    deliverables: [
      'Pipeline stages that match how the business actually sells',
      'Enquiries captured from the website, phone and WhatsApp in one place',
      'Ownership, follow-up reminders and overdue visibility',
      'Quotation and proposal tracking',
      'Reporting on where enquiries come from and what happens to them',
      'Team training and handover',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: ['form.present', 'form.action_valid'],
    sortOrder: 7,
  },
  {
    code: 'web_management_tool',
    name: 'Web management tool',
    family: 'Platform',
    summary:
      'An admin a non-technical person can use confidently, so the site stops going stale between agency visits.',
    deliverables: [
      'Editing screens built around the content that actually changes',
      'Preview before publishing',
      'Role-based access for staff',
      'Media library with automatic image optimisation',
      'Change history and the ability to revert',
      'Training session and a short written guide',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: ['copyright.stale', 'content.demo', 'content.lorem'],
    sortOrder: 8,
  },

  // --- AI services ----------------------------------------------------------
  // Each recommended only where the audit shows a gap it addresses. None of
  // these promises an outcome.
  {
    code: 'ai_assistant',
    name: 'AI enquiry assistant',
    family: 'AI',
    summary:
      'An assistant on the site that answers common questions, captures the enquiry with its context, and hands anything it cannot answer to a person.',
    deliverables: [
      'Assistant trained on the business’s own services and policies',
      'Enquiry capture with the conversation attached',
      'Clear handover to a person, with no pretence of being human',
      'Answers restricted to supplied material, so it does not invent facts',
      'Monthly review of what it was asked and what it got wrong',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: ['whatsapp.link', 'contact.page_missing'],
    sortOrder: 180,
  },
  {
    code: 'ai_content_ops',
    name: 'AI-assisted content production',
    family: 'AI',
    summary:
      'Faster first drafts for service pages and updates. The business approves the wording before anything is published.',
    deliverables: [
      'Tone and terminology guide derived from existing material',
      'Drafts for the pages that need them',
      'Human review step built into the workflow',
      'Editorial calendar the team can keep running',
    ],
    defaultPhase: 'phase_3',
    triggerCategories: [],
    triggerCheckCodes: ['page.thin', 'services.missing'],
    sortOrder: 181,
  },
  {
    code: 'ai_reporting',
    name: 'AI-assisted reporting',
    family: 'AI',
    summary:
      'Monthly reporting drafted automatically from measured data and reviewed by a person before it is sent.',
    deliverables: [
      'Enquiry and source tracking configured first, so there is data to report on',
      'Monthly draft covering what changed and what it appears to have affected',
      'Human review before the report is issued',
      'Figures always traceable to the underlying data',
    ],
    defaultPhase: 'phase_3',
    triggerCategories: [],
    triggerCheckCodes: ['analytics.tag_present'],
    sortOrder: 182,
  },
  {
    code: 'ai_local_presence',
    name: 'AI-assisted local presence management',
    family: 'AI',
    summary:
      'Keeps the Google Business Profile active — descriptions, posts and review replies drafted for approval.',
    deliverables: [
      'Profile completed: description, categories, hours, service areas',
      'Post drafts on a regular cadence',
      'Review replies drafted for approval, never auto-published',
      'Monthly summary of profile activity',
    ],
    defaultPhase: 'phase_3',
    triggerCategories: [],
    triggerCheckCodes: ['gbp.no_description', 'gbp.few_photos', 'gbp.no_hours'],
    sortOrder: 183,
  },
  {
    code: 'brand_development',
    name: 'Brand development',
    family: 'Brand',
    summary:
      'Brand strategy, visual identity and consistency guidelines, for a new launch or an existing brand that has drifted.',
    deliverables: [
      'Brand strategy: positioning, voice and audience definition',
      'Visual identity: logo system, colour, type and layout rules',
      'Brand story developed to carry across every touchpoint',
      'Consistency guidelines so the brand holds up on every platform',
      'Application to website, social profiles and print',
    ],
    defaultPhase: 'phase_2',
    /**
     * Triggered where the audit found the public presence saying different
     * things in different places — a social profile standing in for a website,
     * or profiles that never make clear what the business sells.
     */
    triggerCategories: [],
    triggerCheckCodes: ['gbp.social_as_website', 'social.services_unclear'],
    sortOrder: 190,
  },
  {
    code: 'design_animation_motion',
    name: 'Design, animation and motion',
    family: 'Creative',
    summary:
      'Graphic design and short-form animation: the visual and motion assets that carry a campaign.',
    deliverables: [
      'Graphic design and concept development for campaigns and launches',
      'Short video animations, up to three minutes, for feed and story formats',
      'Explainer and product-motion pieces',
      'A consistent visual language carried across every asset',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 191,
  },
  {
    code: 'visual_media_production',
    name: 'Visual media production',
    family: 'Creative',
    summary:
      'Professional photography and video for brand, product and property — storytelling-led direction, not just coverage.',
    deliverables: [
      'Professional stills for brand, product and property',
      'Video production, from social clips to longer-form content',
      'Storytelling-led direction and shot planning',
      'Edited assets sized for each platform',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 192,
  },
  {
    code: 'real_estate_visualization',
    name: 'Real estate visualization',
    family: 'Property',
    summary:
      'Architectural renders, walkthrough animation and interior visualization, so buyers can experience an off-plan property before it is built.',
    deliverables: [
      'Photorealistic exterior and interior renders',
      'Walkthrough and flythrough animation',
      'Master-plan and site-scale visualizations',
      'Paired with photography and virtual tours for a consistent listing story',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 193,
  },
  {
    code: 'architecture_interior_design',
    name: 'Architecture and interior design',
    family: 'Property',
    summary:
      'Layout and finish resolved before construction: floor plans, space planning and material concepts.',
    deliverables: [
      'Floor plan development and space planning',
      'Material and finish concept boards',
      'Staged interior renders matched to real furnishing options',
      'Coordination with construction and development teams',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 194,
  },
  {
    code: 'property_marketing_management',
    name: 'Property marketing and management',
    family: 'Property',
    summary:
      'The Bright Properties arm: listing, promotion and management for apartments, villas and land across Kampala.',
    deliverables: [
      'Property listings and promotion across multiple platforms',
      'Professional photography, videography and virtual tours',
      'Social media marketing on Instagram, Facebook and TikTok',
      'Email campaigns and search visibility for lead generation',
      '360-degree virtual tours and drone photography',
      'Legal due diligence and structured payment-plan guidance',
    ],
    defaultPhase: 'phase_2',
    triggerCategories: [],
    triggerCheckCodes: [],
    sortOrder: 195,
  },
];
