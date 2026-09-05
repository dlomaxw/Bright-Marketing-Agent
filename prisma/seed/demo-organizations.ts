/**
 * Demonstration prospects.
 *
 * IMPORTANT — read docs/ASSUMPTIONS.md 1 before changing this file.
 *
 * The brief names the "Uganda 100 Website Lead Audit" dataset as the starting
 * data. That file was not supplied. Rather than invent real Ugandan businesses,
 * their websites, their contacts and their website problems — which is exactly
 * what this product exists to prevent — these records are:
 *
 *   - obviously fictional,
 *   - on RESERVED domains (`.test`, `.invalid`, `.example`) that can never
 *     resolve to a real website, so no real business can be affected,
 *   - flagged `isDemoData: true` everywhere they appear in the interface,
 *   - carrying imported findings marked `requiresReverification`, which can
 *     never reach a client-facing document until re-observed.
 *
 * The `issue` and `salesOffer` fields mirror the shape of the reference dataset
 * so the importer and the workflow are exercised realistically. Load the real
 * file with `npm run import -- <path>` when it is available.
 */

export interface DemoOrg {
  legalName: string;
  brandName?: string;
  industry: string;
  city: string;
  website: string | null;
  sector?: 'standard' | 'government' | 'health' | 'education' | 'finance' | 'regulated';
  importedScore: number;
  /** Legacy observation from the reference audit. Imported as needs_review. */
  issue: string;
  salesOffer: string;
  contact?: { name: string; role: string; email?: string; phone?: string; sourceUrl?: string };
  profiles?: { platform: string; url: string }[];
  stage?: string;
}

export const DEMO_ORGANIZATIONS: DemoOrg[] = [
  {
    legalName: 'Kigo Ridge Construction Limited',
    brandName: 'Kigo Ridge Construction',
    industry: 'Construction',
    city: 'Kampala',
    website: 'https://kigoridge.test',
    importedScore: 97,
    issue: 'Root address returned a directory listing rather than a web page.',
    salesOffer: 'rapid_website_launch',
    contact: { name: 'Grace Nabirye', role: 'Managing Director', email: 'md@kigoridge.test', phone: '+256772000101', sourceUrl: 'https://kigoridge.test/about' },
    profiles: [{ platform: 'facebook', url: 'https://facebook.com/kigoridge.test' }],
  },
  {
    legalName: 'Ntinda Fresh Produce Exporters Ltd',
    brandName: 'Ntinda Fresh',
    industry: 'Agriculture and export',
    city: 'Kampala',
    website: 'https://ntindafresh.test',
    importedScore: 95,
    issue: 'Home page displayed a "coming soon" holding page.',
    salesOffer: 'rapid_website_launch',
    contact: { name: 'Samuel Okello', role: 'Commercial Director', email: 'sales@ntindafresh.test', sourceUrl: 'https://ntindafresh.test' },
  },
  {
    legalName: 'Bugolobi Dental Studio',
    industry: 'Healthcare',
    city: 'Kampala',
    website: 'https://bugolobidental.test',
    sector: 'health',
    importedScore: 94,
    issue: 'Default content management sample page publicly reachable.',
    salesOffer: 'wordpress_care',
    contact: { name: 'Dr Aisha Kirabo', role: 'Principal Dentist', email: 'clinic@bugolobidental.test', sourceUrl: 'https://bugolobidental.test/contact' },
    profiles: [{ platform: 'google_business', url: 'https://maps.google.com/?cid=bugolobidental-test' }],
  },
  {
    legalName: 'Masaka Road Logistics Company Limited',
    brandName: 'MRL Logistics',
    industry: 'Transport and logistics',
    city: 'Masaka',
    website: 'https://mrllogistics.test',
    importedScore: 93,
    issue: 'Placeholder Lorem Ipsum text on the services page.',
    salesOffer: 'copywriting',
    contact: { name: 'Peter Wanyama', role: 'Operations Manager', phone: '+256782000114', sourceUrl: 'https://mrllogistics.test/contact' },
  },
  {
    legalName: 'Entebbe Lakeview Hotel Limited',
    brandName: 'Lakeview Entebbe',
    industry: 'Hospitality',
    city: 'Entebbe',
    website: 'https://lakeviewentebbe.test',
    importedScore: 92,
    issue: 'No booking or enquiry path found on the home page.',
    salesOffer: 'conversion_crm',
    contact: { name: 'Miriam Achieng', role: 'General Manager', email: 'gm@lakeviewentebbe.test', sourceUrl: 'https://lakeviewentebbe.test/about' },
    profiles: [
      { platform: 'instagram', url: 'https://instagram.com/lakeviewentebbe.test' },
      { platform: 'facebook', url: 'https://facebook.com/lakeviewentebbe.test' },
    ],
  },
  {
    legalName: 'Jinja Steel Fabricators Ltd',
    industry: 'Manufacturing',
    city: 'Jinja',
    website: 'https://jinjasteel.test',
    importedScore: 91,
    issue: 'Site not available over a secure connection.',
    salesOffer: 'hosting_remediation',
    contact: { name: 'David Ssemwogerere', role: 'Owner', phone: '+256701000122' },
  },
  {
    legalName: 'Kabalagala Learning Centre',
    industry: 'Education',
    city: 'Kampala',
    website: 'https://kabalagalalearning.test',
    sector: 'education',
    importedScore: 90,
    issue: 'Publicly reachable staging site duplicating the main website.',
    salesOffer: 'hosting_remediation',
    contact: { name: 'Rebecca Amuge', role: 'Head Teacher', email: 'admin@kabalagalalearning.test', sourceUrl: 'https://kabalagalalearning.test' },
  },
  {
    legalName: 'Gulu Community Pharmacy Limited',
    industry: 'Healthcare',
    city: 'Gulu',
    website: 'https://gulupharmacy.test',
    sector: 'health',
    importedScore: 89,
    issue: 'Placeholder telephone number published on the contact page.',
    salesOffer: 'content',
    contact: { name: 'Joseph Odongo', role: 'Superintendent Pharmacist', sourceUrl: 'https://gulupharmacy.test/contact' },
  },
  {
    legalName: 'Mbarara Coffee Cooperative Society',
    brandName: 'Mbarara Coffee',
    industry: 'Agriculture',
    city: 'Mbarara',
    website: 'https://mbararacoffee.test',
    importedScore: 88,
    issue: 'No meta description or page title on the home page.',
    salesOffer: 'technical_seo',
    contact: { name: 'Esther Tumusiime', role: 'Marketing Lead', email: 'marketing@mbararacoffee.test' },
  },
  {
    legalName: 'Nakawa Auto Services Limited',
    industry: 'Automotive',
    city: 'Kampala',
    website: 'https://nakawaauto.test',
    importedScore: 87,
    issue: 'Unedited theme demo content across several pages.',
    salesOffer: 'copywriting',
    contact: { name: 'Ronald Kizza', role: 'Director', phone: '+256772000188' },
  },
  {
    legalName: 'Lira District Farmers Union',
    industry: 'Agriculture',
    city: 'Lira',
    website: 'https://liradfu.test',
    importedScore: 86,
    issue: 'No mobile viewport declared; page renders at desktop width on phones.',
    salesOffer: 'website_redesign',
    contact: { name: 'Alice Akello', role: 'Programme Coordinator', email: 'info@liradfu.test' },
  },
  {
    legalName: 'Kololo Legal Chambers',
    industry: 'Professional services',
    city: 'Kampala',
    website: 'https://kololochambers.test',
    sector: 'regulated',
    importedScore: 85,
    issue: 'No privacy policy or terms page linked from the website.',
    salesOffer: 'content',
    contact: { name: 'Patrick Muwanga', role: 'Managing Partner', email: 'partners@kololochambers.test', sourceUrl: 'https://kololochambers.test/team' },
  },
  {
    legalName: 'Fort Portal Tours and Safaris Ltd',
    brandName: 'Fort Portal Safaris',
    industry: 'Tourism',
    city: 'Fort Portal',
    website: 'https://fortportalsafaris.test',
    importedScore: 84,
    issue: 'Images over 2 MB slowing the home page on mobile connections.',
    salesOffer: 'performance_images',
    contact: { name: 'Brian Mugisha', role: 'Owner', email: 'bookings@fortportalsafaris.test' },
    profiles: [{ platform: 'youtube', url: 'https://youtube.com/@fortportalsafaris-test' }],
  },
  {
    legalName: 'Wakiso Water Solutions Limited',
    industry: 'Utilities and engineering',
    city: 'Wakiso',
    website: 'https://wakisowater.test',
    importedScore: 83,
    issue: 'No analytics or measurement tag detected.',
    salesOffer: 'digital_measurement',
    contact: { name: 'Sarah Nakato', role: 'Business Development Manager', email: 'bd@wakisowater.test' },
  },
  {
    legalName: 'Arua Regional Savings and Credit Cooperative',
    brandName: 'Arua SACCO',
    industry: 'Financial services',
    city: 'Arua',
    website: 'https://aruasacco.test',
    sector: 'finance',
    importedScore: 82,
    issue: 'Copyright year four years out of date in the footer.',
    salesOffer: 'wordpress_care',
    contact: { name: 'Emmanuel Draru', role: 'General Manager', sourceUrl: 'https://aruasacco.test/about' },
  },
  {
    legalName: 'Kampala Interior Fitouts Ltd',
    industry: 'Construction and interiors',
    city: 'Kampala',
    website: 'https://kampalafitouts.test',
    importedScore: 81,
    issue: 'No structured data published for the business.',
    salesOffer: 'local_seo',
    contact: { name: 'Doreen Nalwoga', role: 'Director', email: 'hello@kampalafitouts.test' },
  },
  {
    legalName: 'Soroti Poultry Enterprises',
    industry: 'Agriculture',
    city: 'Soroti',
    website: 'https://sorotipoultry.test',
    importedScore: 79,
    issue: 'Very little content on the home page.',
    salesOffer: 'content',
    contact: { name: 'Michael Emor', role: 'Proprietor', phone: '+256772000203' },
  },
  {
    legalName: 'Ndeeba Furniture Works',
    industry: 'Manufacturing',
    city: 'Kampala',
    website: 'https://ndeebafurniture.test',
    importedScore: 78,
    issue: 'No social media profiles linked from the website.',
    salesOffer: 'social_setup',
    contact: { name: 'Hassan Ssekitto', role: 'Owner', phone: '+256752000217' },
  },
  {
    legalName: 'Mukono Technical Institute',
    industry: 'Education',
    city: 'Mukono',
    website: 'https://mukonotechnical.test',
    sector: 'education',
    importedScore: 77,
    issue: 'Missing alternative text on most images.',
    salesOffer: 'accessibility',
    contact: { name: 'Florence Nabukenya', role: 'Principal', email: 'principal@mukonotechnical.test' },
  },
  {
    legalName: 'Kasese Mountain Gear Limited',
    industry: 'Retail',
    city: 'Kasese',
    website: 'https://kasesemountaingear.test',
    importedScore: 76,
    issue: 'No opening hours or map published.',
    salesOffer: 'local_seo',
    contact: { name: 'Julius Baluku', role: 'Store Manager' },
  },
  {
    legalName: 'Bwaise Community Clinic',
    industry: 'Healthcare',
    city: 'Kampala',
    website: null,
    sector: 'health',
    importedScore: 75,
    issue: 'No website found for the organisation at the time of the reference audit.',
    salesOffer: 'rapid_website_launch',
    contact: { name: 'Dr Simon Katumba', role: 'Clinical Director' },
  },
  {
    legalName: 'Hoima Oil Services Support Limited',
    industry: 'Energy services',
    city: 'Hoima',
    website: 'https://hoimaoilservices.test',
    importedScore: 74,
    issue: 'Redirect chain of five hops before reaching the home page.',
    salesOffer: 'hosting_remediation',
    contact: { name: 'Agnes Kabahenda', role: 'Contracts Manager', email: 'contracts@hoimaoilservices.test' },
  },
  {
    legalName: 'Kira Municipal Council Business Directory',
    industry: 'Public sector',
    city: 'Kira',
    website: 'https://kiradirectory.test',
    sector: 'government',
    importedScore: 72,
    issue: 'Broken internal links across the directory listing pages.',
    salesOffer: 'technical_seo',
    contact: { name: 'Robert Ssebugwawo', role: 'Communications Officer', email: 'comms@kiradirectory.test' },
  },
  {
    legalName: 'Nansana Bakery and Confectionery Ltd',
    brandName: 'Nansana Bakery',
    industry: 'Food and beverage',
    city: 'Nansana',
    website: 'https://nansanabakery.test',
    importedScore: 70,
    issue: 'No enquiry form; contact only through a social media link.',
    salesOffer: 'conversion_crm',
    contact: { name: 'Christine Namusoke', role: 'Owner', phone: '+256701000240' },
    profiles: [{ platform: 'facebook', url: 'https://facebook.com/nansanabakery.test' }],
  },
];
