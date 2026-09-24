import dns from 'node:dns/promises';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export interface LinkPreviewView {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

/** Reject IPs that could reach internal infra (SSRF defense). */
function isBlockedIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  if (ip.startsWith('172.')) {
    const second = Number(ip.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true; // ULA / link-local
  return false;
}

async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw AppError.conflict('Invalid URL.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw AppError.conflict('Unsupported URL scheme.');
  if (!u.hostname || u.hostname === 'localhost') throw AppError.forbidden('That host is not allowed.');
  const results = await dns.lookup(u.hostname, { all: true });
  if (results.length === 0 || results.some((r) => isBlockedIp(r.address))) {
    throw AppError.forbidden('That host is not allowed.');
  }
  return u;
}

function extractMeta(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeHtml(m[1].trim());
  }
  return undefined;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Fetch (with SSRF guard + cache) an OpenGraph-style preview for a URL. */
export async function getPreview(rawUrl: string): Promise<LinkPreviewView> {
  const u = await assertSafeUrl(rawUrl);
  const url = u.toString();

  const cached = await prisma.linkPreview.findUnique({ where: { url } });
  const DAY = 86_400_000;
  if (cached && Date.now() - cached.fetchedAt.getTime() < DAY) {
    return { url, title: cached.title, description: cached.description, imageUrl: cached.imageUrl, siteName: cached.siteName };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let view: LinkPreviewView = { url, title: null, description: null, imageUrl: null, siteName: null };
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'CloakBot/1.0 (+link-preview)' },
    });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('text/html')) {
      const html = (await res.text()).slice(0, 200_000);
      const title = extractMeta(html, 'og:title') ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
      view = {
        url,
        title: title ? decodeHtml(title) : null,
        description: extractMeta(html, 'og:description') ?? extractMeta(html, 'description') ?? null,
        imageUrl: extractMeta(html, 'og:image') ?? null,
        siteName: extractMeta(html, 'og:site_name') ?? u.hostname,
      };
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown', url }, 'link preview fetch failed');
  } finally {
    clearTimeout(timer);
  }

  await prisma.linkPreview.upsert({
    where: { url },
    update: { ...view, status: 'OK', fetchedAt: new Date() },
    create: { ...view, status: 'OK' },
  });
  return view;
}

export const linkPreviewService = { getPreview };
