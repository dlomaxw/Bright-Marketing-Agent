/**
 * Bright Thoughts Services — brand configuration.
 *
 * One name, confirmed by the owner. This file previously carried two trading
 * names and a third domain, which meant a client could receive a report headed
 * one way, an email signed another, and a reply-to address on a third domain.
 * Everything client-facing reads from here, so treat a change as a change to
 * the letterhead.
 */
export const BRAND = {
  companyName: 'Bright Thoughts Services',
  legalEntity: 'Bright Thoughts Services',
  productName: 'BrightScope',
  tagline: 'Bold ideas. Real results. Built bright.',

  // Confirmed contact details. These print on every client-facing document, so
  // treat a change here as a change to the letterhead.
  phone: '+256 750 421 224',
  phoneAlt: '+256 761 832 333',
  phones: ['+256 750 421 224', '+256 761 832 333'],
  email: 'info@shinebebright.com',
  websiteUrl: 'https://www.shinebebright.com',
  /**
   * Both domains are live and both are printed on the company profile's
   * contact page, so client-facing documents carry both. The first is the one
   * the platform and mail run on.
   */
  websites: ['www.shinebebright.com', 'www.brightilluminated.com'],
  address: 'The Square Building, 3rd Street, Industrial Area, Kampala, Uganda',
  city: 'Kampala',
  country: 'Uganda',

  /**
   * Logo, served from /public and embedded in every export.
   *
   * `logoPath` is the web path for the browser; `logoFile` is the filesystem
   * path the PDF, DOCX and PowerPoint renderers read at generation time.
   */
  logoPath: '/bright-logo-correct-cRUvVmUo.png',
  logoFile: 'public/bright-logo-correct-cRUvVmUo.png',
  faviconPath: '/favicon.png',

  // Brand palette.
  gold: '#FACC15', // Bright Yellow/Gold Theme Color
  goldDark: '#EAB308',
  navy: '#0F172A', // Slate 900 Deep Navy
  blue: '#1E3A8A', // Royal Blue
  white: '#FFFFFF',
  lightBackground: '#F8FAFC',
  text: '#0F172A',

  // Service catalogue.
  services: [
    { code: 'branding', name: 'Branding & Visual Identity', description: 'Brand strategy, logo design, style guides and visual positioning.' },
    { code: 'digital_marketing', name: 'Digital Marketing & SEO', description: 'Search engine optimization, paid ads, content strategy & lead generation.' },
    { code: 'real_estate_3d', name: 'Real Estate 3D & Virtual Tours', description: 'Architectural 3D rendering, virtual property walk-throughs & interactive tours.' },
    { code: 'architecture_interior', name: 'Architecture & Interior Design', description: 'Architectural planning, space design & interior visualization.' },
    { code: 'video_media', name: 'Video & Media Production', description: 'Commercial videography, corporate media, drone footage & post-production.' },
    { code: 'custom_software', name: 'Custom Software & Web Apps', description: 'Web app development, CRM/ERP platforms, mobile applications & AI tools.' },
  ],
} as const;

export type BrandColor = keyof typeof BRAND;
