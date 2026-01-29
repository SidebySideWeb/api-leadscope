export function normalizeDomain(url: string): string {
  const u = new URL(url);
  let host = u.hostname.toLowerCase();

  if (host.startsWith('www.')) {
    host = host.substring(4);
  }

  return host;
}

export function isSameDomain(a: string, b: string): boolean {
  try {
    return normalizeDomain(a) === normalizeDomain(b);
  } catch {
    return false;
  }
}

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';

  // Normalize trailing slash: keep slash only for root paths
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

export function shouldSkipPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();

  const blocked = [
    '/login',
    '/logout',
    '/admin',
    '/wp-admin',
    '/user',
    '/users',
    '/account',
    '/accounts',
    '/cart',
    '/checkout',
    '/basket'
  ];

  return blocked.some(p => lower.startsWith(p));
}

