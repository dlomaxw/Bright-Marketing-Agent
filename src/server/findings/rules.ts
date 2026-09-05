import type { Confidence, FindingCategory, Severity } from '@/lib/enums';

/**
 * The finding catalogue: the complete, closed set of problems this product is
 * willing to state to a client.
 *
 * A check outcome that has no rule here produces NO finding. This is the
 * mechanism that stops the system inventing problems - the classifier cannot
 * emit anything that is not written down in this file, and every entry has
 * pre-approved, non-alarmist client-facing wording.
 *
 * `impact` is always phrased as a possibility, never a certainty. `recommendation`
 * is an action, not a promise of a result.
 */

export interface FindingRule {
  checkCode: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  /** Neutral restatement of the observation, shown to the client. */
  title: string;
  impact: string;
  recommendation: string;
  /** Service module codes this finding justifies (documentation section 10). */
  services: string[];
  /** Findings a strategist must confirm before they may be shown to a client. */
  requiresManualCheck?: boolean;
}

const R = (r: FindingRule) => r;

export const FINDING_RULES: FindingRule[] = [
  // --- Availability ---------------------------------------------------------
  R({
    checkCode: 'dns.resolves',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The website address did not resolve',
    impact:
      'Visitors who type or click the web address may not reach any page, and search engines may drop the site from results.',
    recommendation:
      'Confirm the domain registration and DNS records with the current provider, then restore or rebuild the site at that address.',
    services: ['rapid_website_launch', 'hosting_remediation'],
  }),
  R({
    checkCode: 'http.reachable',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The website did not return a response',
    impact:
      'Visitors may see a browser error instead of the business, which affects credibility and enquiries.',
    recommendation:
      'Check hosting status and server configuration, then add uptime monitoring so future outages are noticed quickly.',
    services: ['hosting_remediation', 'wordpress_care'],
  }),
  R({
    checkCode: 'http.status',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The home page returned an error status',
    impact:
      'Visitors and search engines may be unable to view the home page, which affects discoverability and enquiries.',
    recommendation:
      'Investigate the server response for the home page and restore a working page, then confirm the fix in Search Console.',
    services: ['hosting_remediation', 'rapid_website_launch'],
  }),
  R({
    checkCode: 'dir.index',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The web address shows a file listing instead of a website',
    impact:
      'Visitors see a list of files rather than the business, and internal file names are publicly visible.',
    recommendation:
      'Publish a proper home page at this address and disable directory listing in the server configuration.',
    services: ['rapid_website_launch', 'hosting_remediation'],
  }),
  R({
    checkCode: 'page.holding',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The web address shows a holding page',
    impact:
      'Visitors arriving from search, cards or social profiles find no information about the services offered, so enquiries are likely to be lost.',
    recommendation:
      'Publish a working site covering services, credibility and contact details, with a clear enquiry path.',
    services: ['rapid_website_launch', 'content', 'conversion_crm'],
  }),
  R({
    checkCode: 'page.parked',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The web address shows a domain parking page',
    impact:
      'Visitors may see advertising or a for-sale notice instead of the business, which affects trust.',
    recommendation:
      'Point the domain to a hosted website and remove the parking configuration at the registrar.',
    services: ['rapid_website_launch', 'hosting_remediation'],
  }),
  R({
    checkCode: 'page.empty',
    category: 'availability',
    severity: 'high',
    confidence: 'high',
    title: 'The home page loaded but contains almost no content',
    impact:
      'Visitors may find nothing to read and leave, and search engines have little to index.',
    recommendation:
      'Confirm the page is rendering as intended and publish the core content the business wants visitors to see.',
    services: ['rapid_website_launch', 'content'],
  }),
  R({
    checkCode: 'redirect.loop',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The website redirects in a loop',
    impact: 'Browsers stop after repeated redirects, so the page never loads for visitors.',
    recommendation:
      'Review the redirect rules in the server or CMS configuration and remove the circular rule.',
    services: ['hosting_remediation'],
  }),
  R({
    checkCode: 'redirect.chain',
    category: 'availability',
    severity: 'medium',
    confidence: 'high',
    title: 'Reaching the home page requires several redirects',
    impact: 'Each redirect adds delay, particularly on mobile connections.',
    recommendation: 'Collapse the redirect chain so the final address is reached in one step.',
    services: ['hosting_remediation', 'technical_seo'],
  }),
  R({
    checkCode: 'https.available',
    category: 'availability',
    severity: 'critical',
    confidence: 'high',
    title: 'The site is not available over a secure connection',
    impact:
      'Browsers may warn visitors that the connection is not private, which affects trust and form completion.',
    recommendation:
      'Install a valid certificate and serve the whole site over HTTPS, then redirect insecure requests.',
    services: ['hosting_remediation'],
  }),
  R({
    checkCode: 'https.redirect',
    category: 'availability',
    severity: 'high',
    confidence: 'high',
    title: 'Insecure requests are not redirected to the secure address',
    impact:
      'Some visitors continue to browse over an insecure connection and may see a browser warning.',
    recommendation: 'Add a site-wide redirect from HTTP to HTTPS at the server or CDN.',
    services: ['hosting_remediation'],
  }),

  // --- CMS hygiene ----------------------------------------------------------
  R({
    checkCode: 'wp.default_pages',
    category: 'cms',
    severity: 'high',
    confidence: 'high',
    title: 'A default content-management sample page is publicly available',
    impact:
      'Search engines and visitors may encounter content that does not represent the organization.',
    recommendation:
      'Remove or redirect the page, update the sitemap, request a re-crawl and review other default content that may be indexed.',
    services: ['wordpress_care', 'technical_seo', 'content'],
  }),
  R({
    checkCode: 'wp.hello_world',
    category: 'cms',
    severity: 'high',
    confidence: 'high',
    title: 'The default first post is still published',
    impact:
      'Visitors may find placeholder content that suggests the site is unfinished.',
    recommendation: 'Delete the default post and review the site for other unedited default content.',
    services: ['wordpress_care', 'content'],
  }),
  R({
    checkCode: 'wp.readme',
    category: 'cms',
    severity: 'medium',
    confidence: 'high',
    title: 'A content-management readme file is publicly served',
    impact:
      'The file publishes platform details that are not intended for visitors and adds no value to the site.',
    recommendation:
      'Remove the file as part of routine site maintenance and add it to the deployment exclusion list.',
    services: ['wordpress_care', 'hosting_remediation'],
  }),
  R({
    checkCode: 'content.lorem',
    category: 'content',
    severity: 'high',
    confidence: 'high',
    title: 'Placeholder Lorem Ipsum text is published on the site',
    impact:
      'Visitors may read filler text where a service description should be, which affects credibility.',
    recommendation:
      'Replace the placeholder text with the intended content and review every page for remaining filler.',
    services: ['content', 'copywriting'],
  }),
  R({
    checkCode: 'content.demo',
    category: 'content',
    severity: 'high',
    confidence: 'high',
    title: 'Unedited template text is published on the site',
    impact:
      'Template wording suggests the site was not finished, which may affect how visitors judge the business.',
    recommendation: 'Replace the template text with content written for the organization.',
    services: ['content', 'copywriting'],
  }),
  R({
    checkCode: 'content.placeholder_contact',
    category: 'trust',
    severity: 'high',
    confidence: 'high',
    title: 'Placeholder contact details are published',
    impact:
      'Visitors who use the published details may not reach the business, so enquiries can be lost without anyone noticing.',
    recommendation:
      'Replace the placeholder telephone number and email address with the correct business details across every page.',
    services: ['content', 'conversion_crm'],
  }),
  R({
    checkCode: 'staging.public',
    category: 'cms',
    severity: 'high',
    confidence: 'high',
    title: 'A test or staging version of the site is publicly reachable',
    impact:
      'Search engines may index the duplicate site, and visitors may land on an out-of-date version.',
    recommendation:
      'Restrict access to the staging site, add a noindex directive, and remove any indexed pages from search results.',
    services: ['hosting_remediation', 'technical_seo', 'wordpress_care'],
  }),

  // --- Technical SEO --------------------------------------------------------
  R({
    checkCode: 'title.missing',
    category: 'seo',
    severity: 'medium',
    confidence: 'high',
    title: 'The home page has no page title',
    impact:
      'Search engines and browser tabs have no title to display, which affects click-through from search results.',
    recommendation: 'Add a descriptive page title containing the business name and its main service.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'title.length',
    category: 'seo',
    severity: 'low',
    confidence: 'high',
    title: 'The page title length is outside the recommended range',
    impact: 'The title may be shortened in search results, reducing its usefulness.',
    recommendation: 'Rewrite the title to sit between roughly 15 and 65 characters.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'meta.description_missing',
    category: 'seo',
    severity: 'medium',
    confidence: 'high',
    title: 'The home page has no meta description',
    impact:
      'Search engines choose their own snippet, which may not describe the business as intended.',
    recommendation: 'Add a meta description that summarises the offer and includes a reason to click.',
    services: ['technical_seo', 'copywriting'],
  }),
  R({
    checkCode: 'meta.description_length',
    category: 'seo',
    severity: 'low',
    confidence: 'high',
    title: 'The meta description length is outside the recommended range',
    impact: 'The description may be cut short in search results.',
    recommendation: 'Rewrite the description to sit between roughly 50 and 165 characters.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'heading.h1_missing',
    category: 'seo',
    severity: 'medium',
    confidence: 'high',
    title: 'The home page has no main heading',
    impact:
      'Search engines and screen readers have no clear statement of what the page is about.',
    recommendation: 'Add a single H1 heading describing the business and its main service.',
    services: ['technical_seo', 'content'],
  }),
  R({
    checkCode: 'heading.h1_multiple',
    category: 'seo',
    severity: 'low',
    confidence: 'high',
    title: 'The home page has more than one main heading',
    impact: 'Multiple H1 headings weaken the signal about the page topic.',
    recommendation: 'Keep one H1 and demote the others to H2 or H3.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'heading.order',
    category: 'accessibility',
    severity: 'low',
    confidence: 'medium',
    title: 'The heading structure skips levels',
    impact: 'Screen-reader users navigating by heading may find the page structure confusing.',
    recommendation: 'Order headings sequentially so no level is skipped.',
    services: ['accessibility'],
  }),
  R({
    checkCode: 'canonical.missing',
    category: 'seo',
    severity: 'medium',
    confidence: 'high',
    title: 'No canonical address is declared',
    impact:
      'Search engines may treat several addresses as separate pages, splitting their ranking signals.',
    recommendation: 'Declare a canonical URL on every page.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'canonical.conflicting',
    category: 'seo',
    severity: 'high',
    confidence: 'high',
    title: 'The canonical address points somewhere unexpected',
    impact:
      'Search engines may attribute this page to another address and drop it from results.',
    recommendation: 'Correct the canonical tag so it points to this page on this domain.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'indexability.noindex',
    category: 'seo',
    severity: 'critical',
    confidence: 'high',
    title: 'The home page asks search engines not to index it',
    impact:
      'While this instruction remains, the page is unlikely to appear in search results at all.',
    recommendation:
      'Remove the noindex directive if the page is meant to be found, then request re-indexing.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'robots.txt_missing',
    category: 'seo',
    severity: 'low',
    confidence: 'high',
    title: 'No robots.txt file is published',
    impact:
      'Crawlers have no guidance on which areas to crawl, and no sitemap reference to follow.',
    recommendation: 'Publish a robots.txt file that references the XML sitemap.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'robots.blocks_all',
    category: 'seo',
    severity: 'critical',
    confidence: 'high',
    title: 'robots.txt asks search engines not to crawl the site',
    impact: 'The site is unlikely to appear in search results while this rule is in place.',
    recommendation:
      'Correct the robots.txt rule so the public pages may be crawled, then request re-indexing.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'sitemap.missing',
    category: 'seo',
    severity: 'medium',
    confidence: 'high',
    title: 'No XML sitemap was found',
    impact: 'Search engines may take longer to discover pages, particularly new ones.',
    recommendation:
      'Publish an XML sitemap, reference it in robots.txt and submit it in Search Console.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'link.internal_broken',
    category: 'seo',
    severity: 'medium',
    confidence: 'high',
    title: 'Some internal links do not lead to a working page',
    impact: 'Visitors following those links reach an error, and crawl signals are wasted.',
    recommendation: 'Correct or redirect the broken links and re-check after publishing.',
    services: ['technical_seo', 'wordpress_care'],
  }),
  R({
    checkCode: 'schema.missing',
    category: 'seo',
    severity: 'low',
    confidence: 'high',
    title: 'No structured data is published',
    impact:
      'Search engines have no machine-readable business details, which limits enhanced search listings.',
    recommendation: 'Add Organization or LocalBusiness structured data with the verified details.',
    services: ['technical_seo', 'local_seo'],
  }),
  R({
    checkCode: 'schema.invalid',
    category: 'seo',
    severity: 'medium',
    confidence: 'high',
    title: 'A structured data block is not valid',
    impact: 'Invalid structured data is ignored, so the intended search features do not appear.',
    recommendation: 'Correct the structured data and validate it with a testing tool.',
    services: ['technical_seo'],
  }),
  R({
    checkCode: 'lang.missing',
    category: 'accessibility',
    severity: 'low',
    confidence: 'high',
    title: 'The page does not declare its language',
    impact: 'Screen readers may use the wrong pronunciation rules.',
    recommendation: 'Add a lang attribute to the html element.',
    services: ['accessibility'],
  }),

  // --- Content --------------------------------------------------------------
  R({
    checkCode: 'page.thin',
    category: 'content',
    severity: 'medium',
    confidence: 'high',
    title: 'The home page has very little content',
    impact:
      'Visitors may not find enough information to make an enquiry, and search engines have little to index.',
    recommendation:
      'Expand the home page to cover the main services, the market served and a clear next step.',
    services: ['content', 'copywriting'],
  }),
  R({
    checkCode: 'services.missing',
    category: 'content',
    severity: 'high',
    confidence: 'medium',
    title: 'No services or products section was found',
    impact:
      'Visitors may be unable to tell what the business offers, which affects enquiry rates.',
    recommendation:
      'Add a services section with a page for each main service, written for the customer the business wants.',
    services: ['content', 'copywriting', 'technical_seo'],
    requiresManualCheck: true,
  }),
  R({
    checkCode: 'about.missing',
    category: 'trust',
    severity: 'low',
    confidence: 'medium',
    title: 'No company background section was found',
    impact: 'Visitors have less information on which to judge credibility.',
    recommendation: 'Add a short company background section covering experience and market served.',
    services: ['content', 'copywriting'],
    requiresManualCheck: true,
  }),
  R({
    checkCode: 'copyright.stale',
    category: 'content',
    severity: 'low',
    confidence: 'high',
    title: 'The published copyright year is out of date',
    impact: 'Visitors may assume the business is no longer active or the site is unmaintained.',
    recommendation: 'Update the footer year and set it to update automatically.',
    services: ['wordpress_care'],
  }),
  R({
    checkCode: 'contact.page_missing',
    category: 'conversion',
    severity: 'high',
    confidence: 'high',
    title: 'No contact page is linked from the home page',
    impact: 'Visitors who want to make an enquiry may not find how to do so.',
    recommendation: 'Add a clearly linked contact page with a form, telephone number and location.',
    services: ['conversion_crm', 'content'],
  }),

  // --- Performance ----------------------------------------------------------
  R({
    checkCode: 'page.weight',
    category: 'performance',
    severity: 'medium',
    confidence: 'high',
    title: 'The home page document is unusually large',
    impact: 'Larger pages take longer to load, particularly on mobile data connections.',
    recommendation:
      'Reduce the page document size and set a performance budget for future changes.',
    services: ['performance_images'],
  }),
  R({
    checkCode: 'image.oversized',
    category: 'performance',
    severity: 'medium',
    confidence: 'high',
    title: 'Some images are much larger than needed',
    impact:
      'Large images slow the page for visitors on mobile connections and consume their data.',
    recommendation:
      'Resize and compress the images, and serve appropriately sized versions for each device.',
    services: ['performance_images'],
  }),
  R({
    checkCode: 'image.format_legacy',
    category: 'performance',
    severity: 'low',
    confidence: 'medium',
    title: 'Images use older file formats only',
    impact: 'Modern formats typically transfer the same image in substantially fewer bytes.',
    recommendation: 'Serve WebP or AVIF versions with a fallback for older browsers.',
    services: ['performance_images'],
  }),
  R({
    checkCode: 'image.lazy_missing',
    category: 'performance',
    severity: 'low',
    confidence: 'high',
    title: 'Images are not lazy loaded',
    impact: 'All images load immediately, including those the visitor may never scroll to.',
    recommendation: 'Add lazy loading to images below the first screen.',
    services: ['performance_images'],
  }),
  R({
    checkCode: 'render.blocking_assets',
    category: 'performance',
    severity: 'medium',
    confidence: 'medium',
    title: 'Scripts in the page head delay the first render',
    impact: 'The page may appear blank for longer than necessary while scripts load.',
    recommendation: 'Defer or asynchronously load non-critical scripts.',
    services: ['performance_images'],
  }),

  // --- Mobile and accessibility --------------------------------------------
  R({
    checkCode: 'viewport.missing',
    category: 'mobile',
    severity: 'high',
    confidence: 'high',
    title: 'The site does not declare a mobile viewport',
    impact:
      'Mobile browsers render the page at desktop width, so visitors must pinch and zoom to read it.',
    recommendation: 'Add a responsive viewport declaration and confirm the layout adapts.',
    services: ['website_redesign', 'performance_images'],
  }),
  R({
    checkCode: 'viewport.fixed_width',
    category: 'mobile',
    severity: 'high',
    confidence: 'high',
    title: 'The layout is fixed to a set width on mobile',
    impact: 'The page does not adapt to the visitor’s screen, which affects readability.',
    recommendation: 'Set the viewport to device-width and review the responsive layout.',
    services: ['website_redesign'],
  }),
  R({
    checkCode: 'a11y.img_alt',
    category: 'accessibility',
    severity: 'low',
    confidence: 'high',
    title: 'Some images have no alternative text',
    impact:
      'Screen-reader users receive no description of those images, and search engines have less context.',
    recommendation: 'Add descriptive alt text to meaningful images and empty alt to decorative ones.',
    services: ['accessibility', 'technical_seo'],
  }),
  R({
    checkCode: 'a11y.form_labels',
    category: 'accessibility',
    severity: 'medium',
    confidence: 'high',
    title: 'Some form fields have no associated label',
    impact:
      'Screen-reader users may not know what a field is for, which can prevent an enquiry being completed.',
    recommendation: 'Associate a visible label with every form field.',
    services: ['accessibility', 'conversion_crm'],
  }),
  R({
    checkCode: 'a11y.link_text',
    category: 'accessibility',
    severity: 'low',
    confidence: 'medium',
    title: 'Several links use non-descriptive text',
    impact: 'Users navigating by link list cannot tell where the links lead.',
    recommendation: 'Rewrite link text to describe the destination.',
    services: ['accessibility', 'copywriting'],
  }),
  R({
    checkCode: 'a11y.lang',
    category: 'accessibility',
    severity: 'low',
    confidence: 'high',
    title: 'No document language is declared',
    impact: 'Assistive technology may apply the wrong pronunciation rules.',
    recommendation: 'Declare the document language.',
    services: ['accessibility'],
  }),

  // --- Conversion -----------------------------------------------------------
  R({
    checkCode: 'tel.link',
    category: 'conversion',
    severity: 'medium',
    confidence: 'high',
    title: 'There is no click-to-call link',
    impact: 'Mobile visitors must copy the number by hand, which loses some enquiries.',
    recommendation: 'Make the telephone number a tel: link in the header and footer.',
    services: ['conversion_crm'],
  }),
  R({
    checkCode: 'whatsapp.link',
    category: 'conversion',
    severity: 'medium',
    confidence: 'high',
    title: 'There is no WhatsApp contact option',
    impact:
      'WhatsApp is a common enquiry channel in this market, and its absence may reduce contact volume.',
    recommendation: 'Add a WhatsApp contact button and route it to a monitored business number.',
    services: ['conversion_crm'],
  }),
  R({
    checkCode: 'contact.phone_visible',
    category: 'conversion',
    severity: 'high',
    confidence: 'high',
    title: 'No telephone number is visible on the home page',
    impact: 'Visitors who prefer to call may leave without finding a number.',
    recommendation: 'Publish the telephone number prominently in the header and footer.',
    services: ['conversion_crm', 'content'],
  }),
  R({
    checkCode: 'contact.email_visible',
    category: 'conversion',
    severity: 'medium',
    confidence: 'high',
    title: 'No email address is visible on the home page',
    impact: 'Visitors who prefer email have no direct way to make contact.',
    recommendation: 'Publish a monitored business email address, or provide an enquiry form.',
    services: ['conversion_crm'],
  }),
  R({
    checkCode: 'form.present',
    category: 'conversion',
    severity: 'high',
    confidence: 'high',
    title: 'No enquiry form was found',
    impact: 'Visitors who do not wish to call have no low-friction way to make an enquiry.',
    recommendation:
      'Add an enquiry form that routes to a monitored inbox and records the enquiry source.',
    services: ['conversion_crm'],
  }),
  R({
    checkCode: 'form.action_valid',
    category: 'conversion',
    severity: 'critical',
    confidence: 'medium',
    title: 'A form has no submission target',
    impact:
      'Enquiries submitted through the form may not reach anyone, and the visitor would not know.',
    recommendation:
      'Configure the form to submit to a working handler, then test it end to end and confirm delivery.',
    services: ['conversion_crm'],
    requiresManualCheck: true,
  }),
  R({
    checkCode: 'booking.present',
    category: 'conversion',
    severity: 'low',
    confidence: 'medium',
    title: 'No booking or quotation path was found',
    impact: 'Visitors ready to act have no obvious next step.',
    recommendation: 'Add a quotation or booking path suited to how the business sells.',
    services: ['conversion_crm'],
  }),
  R({
    checkCode: 'analytics.tag_present',
    category: 'conversion',
    severity: 'medium',
    confidence: 'medium',
    title: 'No analytics or measurement tag was detected',
    impact:
      'Without measurement, the business cannot see how many visitors arrive or how many enquire, so marketing decisions rely on guesswork.',
    recommendation:
      'Install analytics, define the enquiry events that matter, and report on them monthly.',
    services: ['digital_measurement', 'conversion_crm'],
  }),

  // --- Trust ----------------------------------------------------------------
  R({
    checkCode: 'privacy.page',
    category: 'trust',
    severity: 'medium',
    confidence: 'high',
    title: 'No privacy policy is linked',
    impact:
      'A privacy policy is expected where a site collects enquiries, and its absence may affect trust and compliance obligations.',
    recommendation: 'Publish a privacy policy covering what is collected and how it is used.',
    services: ['content'],
  }),
  R({
    checkCode: 'terms.page',
    category: 'trust',
    severity: 'low',
    confidence: 'high',
    title: 'No terms and conditions page is linked',
    impact: 'Visitors have no published statement of the terms of engagement.',
    recommendation: 'Publish terms appropriate to how the business sells.',
    services: ['content'],
  }),
  R({
    checkCode: 'social.links_present',
    category: 'social',
    severity: 'low',
    confidence: 'high',
    title: 'No social media profiles are linked from the site',
    impact:
      'Visitors cannot easily verify recent activity, and social channels receive no traffic from the site.',
    recommendation: 'Link the active social profiles from the header or footer.',
    services: ['social_setup'],
  }),

  // --- Local ----------------------------------------------------------------
  R({
    checkCode: 'nap.present',
    category: 'local',
    severity: 'medium',
    confidence: 'medium',
    title: 'Business location details are incomplete on the site',
    impact:
      'Consistent name, address and telephone details support local search visibility; gaps may weaken it.',
    recommendation:
      'Publish the full business name, address and telephone number consistently across the site and directories.',
    services: ['local_seo'],
  }),
  R({
    checkCode: 'map.embed',
    category: 'local',
    severity: 'low',
    confidence: 'high',
    title: 'No map or directions are provided',
    impact: 'Visitors who want to visit have no easy way to find the location.',
    recommendation: 'Add a map embed or a directions link on the contact page.',
    services: ['local_seo'],
  }),
  R({
    checkCode: 'hours.published',
    category: 'local',
    severity: 'low',
    confidence: 'medium',
    title: 'Opening hours are not published',
    impact: 'Visitors do not know when they can call or visit.',
    recommendation: 'Publish opening hours on the site and keep them consistent with Google.',
    services: ['local_seo'],
  }),
  R({
    checkCode: 'schema.localbusiness',
    category: 'local',
    severity: 'low',
    confidence: 'high',
    title: 'No local business structured data is published',
    impact: 'Search engines have no machine-readable location or contact details.',
    recommendation: 'Add LocalBusiness structured data matching the published details.',
    services: ['local_seo', 'technical_seo'],
  }),

  // --- Google Business listing ---------------------------------------------
  // Observed on the public listing rather than on a website. The evidence URL
  // is the listing itself, so every claim here can be checked at source.
  R({
    checkCode: 'gbp.no_website',
    category: 'local',
    severity: 'high',
    confidence: 'high',
    title: 'The business is listed on Google with no website',
    impact:
      'People who find the business on Google have no page to learn what it offers, check credibility or make an enquiry outside opening hours.',
    recommendation:
      'Publish a website covering the services offered, the areas served and a clear enquiry path, then link it from the Google Business Profile.',
    services: ['rapid_website_launch', 'conversion_crm', 'local_seo'],
  }),
  R({
    checkCode: 'gbp.social_as_website',
    category: 'local',
    severity: 'medium',
    confidence: 'high',
    title: 'A social page is used in place of a website',
    impact:
      'The business depends on a platform it does not control for its main online presence, and a social page is harder to find in search than a website.',
    recommendation:
      'Publish a website the business owns, keep the social profile linked to it, and route enquiries through a form the business controls.',
    services: ['rapid_website_launch', 'conversion_crm'],
  }),
  R({
    checkCode: 'gbp.no_description',
    category: 'local',
    severity: 'low',
    confidence: 'high',
    title: 'The Google listing has no business description',
    impact: 'People deciding between listings have less information on which to choose.',
    recommendation: 'Write a business description for the Google Business Profile.',
    services: ['local_seo', 'copywriting'],
  }),
  R({
    checkCode: 'gbp.few_photos',
    category: 'local',
    severity: 'low',
    confidence: 'high',
    title: 'The Google listing has few photos',
    impact: 'Listings with more photos give people more confidence before visiting or calling.',
    recommendation: 'Add current photos of the premises, team and work to the Google Business Profile.',
    services: ['local_seo', 'content_production'],
  }),
  R({
    checkCode: 'gbp.no_hours',
    category: 'local',
    severity: 'medium',
    confidence: 'high',
    title: 'The Google listing publishes no opening hours',
    impact:
      'People cannot tell when the business is open, and Google is less likely to show it for searches made nearby.',
    recommendation: 'Publish opening hours on the Google Business Profile and keep them current.',
    services: ['local_seo'],
  }),

  // --- Reviews and audience -------------------------------------------------
  // Read from the Google Places API. The rating and review count are complete;
  // review text is a sample of at most five, which the wording reflects.
  R({
    checkCode: 'gbp.no_reviews',
    category: 'local',
    severity: 'medium',
    confidence: 'high',
    title: 'The Google listing has no reviews',
    impact:
      'People comparing nearby options have no independent signal about the business, and listings with reviews are generally chosen ahead of those without.',
    recommendation:
      'Introduce a routine for asking satisfied customers to review, and respond to each review as it arrives.',
    services: ['local_seo', 'ai_local_presence'],
  }),
  R({
    checkCode: 'gbp.few_reviews',
    category: 'local',
    severity: 'low',
    confidence: 'high',
    title: 'The Google listing has very few reviews',
    impact: 'A small number of reviews carries less weight than a steady, recent stream.',
    recommendation: 'Put a review request into the normal end-of-job process.',
    services: ['local_seo', 'ai_local_presence'],
  }),
  R({
    checkCode: 'gbp.low_rating',
    category: 'local',
    severity: 'medium',
    confidence: 'high',
    title: 'The average Google rating is below four stars',
    impact:
      'Many people filter to four stars and above, so the listing may be skipped before it is read.',
    recommendation:
      'Read the lower-rated reviews for a recurring theme, respond to each, and address the cause before asking for new reviews.',
    services: ['local_seo'],
    requiresManualCheck: true,
  }),
  R({
    checkCode: 'gbp.reviews_dormant',
    category: 'local',
    severity: 'low',
    confidence: 'medium',
    title: 'No recent reviews on the Google listing',
    impact: 'A listing with only old reviews can read as a business that is no longer active.',
    recommendation: 'Restart review requests so the listing shows recent activity.',
    services: ['local_seo', 'ai_local_presence'],
  }),
  R({
    checkCode: 'social.services_unclear',
    category: 'social',
    severity: 'medium',
    confidence: 'medium',
    title: 'Public profiles do not make clear what the business sells',
    impact:
      'Someone who finds the business through a listing or profile may not be able to tell whether it offers what they need.',
    recommendation:
      'State the main services in the Google description and on each social profile, in the words customers use.',
    services: ['local_seo', 'social_setup', 'copywriting'],
    requiresManualCheck: true,
  }),
];

const BY_CODE = new Map(FINDING_RULES.map((r) => [r.checkCode, r]));

export function ruleFor(checkCode: string): FindingRule | undefined {
  return BY_CODE.get(checkCode);
}

export const RULE_COUNT = FINDING_RULES.length;
