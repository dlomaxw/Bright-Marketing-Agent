import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * Fixture sites for testing the audit engine against real HTTP responses rather
 * than mocks. Each case reproduces one failure mode the product documentation
 * requires the tool to handle correctly.
 *
 * Each case listens on its OWN PORT, because several checks are origin-scoped
 * (robots.txt, /sample-page/, staging subdomains). Sharing one origin would let
 * one case's residue leak into another's result.
 *
 *   npm run fixtures     -> index at http://localhost:4310
 *
 * Add a prospect whose website is the case URL, then run an audit.
 */

const BASE_PORT = Number(process.env.FIXTURE_PORT ?? 4310);

const page = (title: string, body: string, head = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head>
<body>${body}</body></html>`;

interface Fixture {
  slug: string;
  description: string;
  /** Routes for this origin. `/` is the home page. */
  routes: Record<
    string,
    | { status?: number; type?: string; body: string }
    | { redirectTo: string }
    | 'never-responds'
  >;
  robots?: string;
}

const YEAR = new Date().getFullYear();

const HEALTHY_HOME = page(
  'Kigo Ridge Construction — Commercial builders in Kampala',
  `<h1>Commercial construction in Kampala</h1>
   <h2>Our services</h2>
   <p>We build and fit out commercial premises across Uganda, from warehouses to retail units. Our
      team has delivered projects in Kampala, Entebbe and Jinja since 2009. We handle design,
      structural work, finishing and handover, and we publish a fixed programme before work starts.
      Every project has a named site manager and a weekly progress report.</p>
   <h2>About us</h2>
   <p>Kigo Ridge Construction Limited is a Ugandan company based on Plot 44, Kampala Road, Kampala.
      Opening hours: Mon - Fri 08:00 - 17:00.</p>
   <h3>Contact</h3>
   <p>Telephone: <a href="tel:+256414000000">+256 414 000 000</a> ·
      <a href="mailto:hello@kigoridge.example">hello@kigoridge.example</a> ·
      <a href="https://wa.me/256772000000">Message us on WhatsApp</a></p>
   <h2>Request a quotation</h2>
   <form action="/enquiry" method="post">
     <label for="name">Your name</label><input id="name" name="name">
     <label for="msg">What do you need?</label><textarea id="msg" name="msg"></textarea>
     <button type="submit">Send enquiry</button>
   </form>
   <img src="/logo.png" alt="Kigo Ridge Construction logo" loading="lazy">
   <p><a href="/privacy">Privacy policy</a> · <a href="/terms">Terms and conditions</a> ·
      <a href="/contact">Contact our team</a> · <a href="/services">Our services</a></p>
   <p><a href="https://facebook.com/example">Facebook</a></p>
   <iframe title="Where to find us" src="https://www.google.com/maps/embed?pb=x"></iframe>
   <p>&copy; ${YEAR} Kigo Ridge Construction Limited</p>`,
  `<meta name="viewport" content="width=device-width, initial-scale=1">
   <meta name="description" content="Kigo Ridge Construction builds and fits out commercial premises across Uganda, with fixed programmes and published handover dates.">
   <script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
   <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Kigo Ridge Construction Limited","telephone":"+256414000000","address":"Plot 44, Kampala Road, Kampala"}</script>`,
);

const simplePage = (title: string) => page(title, `<h1>${title}</h1><p>Content for ${title}.</p>`);

export const FIXTURES: Fixture[] = [
  {
    slug: 'healthy',
    description: 'A well-configured site. Should produce no content, CMS or SEO findings.',
    routes: {
      '/': { body: HEALTHY_HOME },
      '/privacy': { body: simplePage('Privacy policy') },
      '/terms': { body: simplePage('Terms and conditions') },
      '/contact': { body: simplePage('Contact our team') },
      '/services': { body: simplePage('Our services') },
      '/logo.png': { type: 'image/webp', body: 'fake-webp-bytes' },
    },
  },
  {
    slug: 'directory-index',
    description: 'Server returns a directory listing instead of a page.',
    routes: {
      '/': {
        body: `<html><head><title>Index of /</title></head><body><h1>Index of /</h1><pre><a href="../">Parent Directory</a>
<a href="backup/">backup/</a>
<a href="index.php">index.php</a></pre></body></html>`,
      },
    },
  },
  {
    slug: 'coming-soon',
    description: 'Holding page at the root address.',
    routes: {
      '/': {
        body: page('Coming Soon', '<h1>Coming soon</h1><p>Our website is under construction. Please check back later.</p>'),
      },
    },
  },
  {
    slug: 'wordpress-residue',
    description: 'Default CMS sample page and first post still published.',
    routes: {
      '/': { body: page('Home', '<h1>Welcome</h1><p>We are a company that does things for clients across the region every day.</p>') },
      '/sample-page/': {
        body: page(
          'Sample Page',
          `<h1>Sample Page</h1><p>This is an example page. It's different from a blog post because it will stay in one place and will show up in your site navigation.</p>`,
        ),
      },
      '/hello-world/': {
        body: page('Hello world!', '<h1>Hello world!</h1><p>Welcome to WordPress. This is your first post. Edit or delete it, then start writing!</p>'),
      },
      '/readme.html': { body: page('readme', '<h1>WordPress</h1><p>Semantic Personal Publishing Platform</p>') },
    },
  },
  {
    slug: 'template-residue',
    description: 'Lorem ipsum, template text, placeholder contact details, no metadata.',
    routes: {
      '/': {
        body: page(
          '',
          `<h2>Your Business Tagline</h2>
           <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
              incididunt ut labore et dolore magna aliqua. Duis aute irure dolor.</p>
           <p>Call us on 555-123-4567 or email info@example.com</p>
           <img src="/p1.jpg"><img src="/p2.jpg"><img src="/p3.jpg">
           <img src="/p4.jpg"><img src="/p5.jpg"><img src="/p6.jpg">
           <p><a href="/gone-a">Click here</a> <a href="/gone-b">Read more</a> <a href="/gone-c">More</a></p>
           <p>&copy; 2019 Some Company</p>`,
        ),
      },
    },
  },
  {
    slug: 'server-error',
    description: 'Home page returns HTTP 500.',
    routes: { '/': { status: 500, body: 'Internal Server Error' } },
  },
  {
    slug: 'noindex',
    description: 'Home page asks search engines not to index it.',
    routes: {
      '/': {
        body: page(
          'Our company',
          '<h1>Our company</h1><p>We provide services to businesses across the country and have done so for many years now.</p>',
          '<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width">',
        ),
      },
    },
  },
  {
    slug: 'redirect-loop',
    description: 'Redirect chain that returns to a previous URL.',
    routes: { '/': { redirectTo: '/b' }, '/b': { redirectTo: '/' } },
  },
  {
    slug: 'long-redirect',
    description: 'Five redirects before the home page.',
    routes: {
      '/': { redirectTo: '/1' },
      '/1': { redirectTo: '/2' },
      '/2': { redirectTo: '/3' },
      '/3': { redirectTo: '/4' },
      '/4': { body: page('Arrived', '<h1>Arrived</h1><p>Reached after several redirects, which delays the first view.</p>') },
    },
  },
  {
    slug: 'robots-blocked',
    description: 'robots.txt disallows everything. Must produce "unable to verify", never a bypass.',
    routes: { '/': { body: page('Blocked', '<h1>You should not be reading this</h1>') } },
    robots: 'User-agent: *\nDisallow: /\n',
  },
  {
    slug: 'timeout',
    description: 'Server accepts the connection and never responds.',
    routes: { '/': 'never-responds' },
  },
];

function handler(fixture: Fixture, port: number) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;

    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(fixture.robots ?? `User-agent: *\nAllow: /\nSitemap: http://localhost:${port}/sitemap.xml\n`);
      return;
    }
    if (path === '/sitemap.xml') {
      if (fixture.slug === 'healthy') {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(
            fixture.routes,
          )
            .map((p) => `<url><loc>http://localhost:${port}${p}</loc></url>`)
            .join('')}</urlset>`,
        );
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const route = fixture.routes[path];
    if (route === 'never-responds') return; // deliberately hangs

    if (route && 'redirectTo' in route) {
      res.writeHead(302, { location: route.redirectTo });
      res.end();
      return;
    }
    if (route) {
      res.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'text/html; charset=utf-8' });
      res.end(route.body);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(page('Not found', '<h1>404</h1>'));
  };
}

export function fixtureUrl(slug: string): string {
  const index = FIXTURES.findIndex((f) => f.slug === slug);
  if (index < 0) throw new Error(`Unknown fixture: ${slug}`);
  return `http://localhost:${BASE_PORT + 1 + index}/`;
}

function start(): void {
  FIXTURES.forEach((fixture, index) => {
    const port = BASE_PORT + 1 + index;
    createServer(handler(fixture, port)).listen(port, () => {
      console.log(`  ${fixture.slug.padEnd(18)} http://localhost:${port}/  — ${fixture.description}`);
    });
  });

  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      page(
        'BrightScope audit fixtures',
        `<h1>BrightScope audit fixtures</h1>
         <p>Each case runs on its own origin, so origin-scoped checks cannot leak between them.</p>
         <ul>${FIXTURES.map(
           (f, i) =>
             `<li><a href="http://localhost:${BASE_PORT + 1 + i}/">${f.slug}</a> — ${f.description}</li>`,
         ).join('')}</ul>`,
      ),
    );
  }).listen(BASE_PORT, () => {
    console.log(`\nFixture index: http://localhost:${BASE_PORT}\n`);
  });
}

if (process.argv[1]?.includes('fixtures')) start();
