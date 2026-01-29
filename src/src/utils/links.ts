export function getOrigin(url: string): string {
  const parsed = new URL(url);
  return parsed.origin;
}

export function isSameDomain(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

export function generateSeedUrls(baseUrl: string): string[] {
  const origin = getOrigin(baseUrl);

  const paths = [
    '/', // root
    '', // original URL (may include path)
    '/contact',
    '/about',
    '/team',
    '/privacy',
    // Greek equivalents / common variants
    '/επικοινωνια',
    '/επικοινωνία',
    '/σχετικα',
    '/σχετικά',
    '/ομαδα',
    '/ομάδα',
    '/πολιτικη-απορρητου',
    '/πολιτική-απορρήτου'
  ];

  const urls = new Set<string>();

  for (const path of paths) {
    try {
      if (path === '') {
        urls.add(baseUrl);
      } else {
        const url = new URL(path, origin).toString();
        urls.add(url);
      }
    } catch {
      // Ignore invalid combinations
    }
  }

  return Array.from(urls);
}

