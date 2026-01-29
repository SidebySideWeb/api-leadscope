import axios from 'axios';
import robotsParser from 'robots-parser';

const ROBOTS_CACHE = new Map<string, ReturnType<typeof robotsParser>>();

function getRobotsUrl(url: string): string {
  const u = new URL(url);
  return `${u.origin}/robots.txt`;
}

export async function isAllowedByRobots(
  url: string,
  userAgent: string
): Promise<boolean> {
  const robotsUrl = getRobotsUrl(url);

  let parser = ROBOTS_CACHE.get(robotsUrl);

  if (!parser) {
    try {
      const resp = await axios.get<string>(robotsUrl, {
        timeout: 5000,
        validateStatus: status => status >= 200 && status < 500
      });

      if (resp.status >= 400) {
        // Missing or inaccessible robots.txt – treat as allowed
        return true;
      }

      parser = robotsParser(robotsUrl, resp.data);
      ROBOTS_CACHE.set(robotsUrl, parser);
    } catch {
      // Network or parsing error – be permissive but safe
      return true;
    }
  }

  try {
    const allowed = parser!.isAllowed(url, userAgent);
    return allowed ?? true;
  } catch {
    return true;
  }
}

