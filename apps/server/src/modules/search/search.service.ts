import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { messageInclude } from '../../common/messageInclude.js';
import { toPublicMessage, type PublicMessage } from '../../common/mappers.js';

export interface SearchResult {
  message: PublicMessage;
  channel: { id: string; slug: string; name: string } | null;
}

interface ParsedQuery {
  text: string[];
  from?: string;
  channel?: string;
  has: Set<string>;
  after?: Date;
  before?: Date;
}

/** Parse "from:User channel:tech has:image after:2026-09-01 kubernetes". */
function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { text: [], has: new Set() };
  for (const token of raw.split(/\s+/).filter(Boolean)) {
    const m = /^(\w+):(.+)$/.exec(token);
    if (!m) {
      parsed.text.push(token);
      continue;
    }
    const [, key, value] = m;
    switch (key.toLowerCase()) {
      case 'from':
        parsed.from = value.replace(/^@/, '').toLowerCase();
        break;
      case 'channel':
        parsed.channel = value.replace(/^#/, '').toLowerCase();
        break;
      case 'has':
        parsed.has.add(value.toLowerCase());
        break;
      case 'after': {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) parsed.after = d;
        break;
      }
      case 'before': {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) parsed.before = d;
        break;
      }
      default:
        parsed.text.push(token);
    }
  }
  return parsed;
}

export async function searchMessages(profileId: string, raw: string): Promise<SearchResult[]> {
  const q = parseQuery(raw);
  const text = q.text.join(' ').trim();
  if (!text && !q.from && !q.channel && q.has.size === 0 && !q.after && !q.before) return [];

  const where: Prisma.MessageWhereInput = {
    deletedAt: null,
    channelId: { not: null },
    // Only search channels the caller can see.
    channel: { is: { OR: [{ visibility: 'PUBLIC' }, { members: { some: { profileId } } }] } },
  };
  if (text) where.body = { contains: text, mode: 'insensitive' };
  if (q.from) where.author = { is: { usernameLower: q.from } };
  if (q.channel) where.channel = { is: { slug: q.channel, OR: [{ visibility: 'PUBLIC' }, { members: { some: { profileId } } }] } };
  if (q.after || q.before) where.createdAt = { ...(q.after ? { gte: q.after } : {}), ...(q.before ? { lte: q.before } : {}) };

  const attachmentFilters: Prisma.MessageWhereInput[] = [];
  if (q.has.has('image')) attachmentFilters.push({ attachments: { some: { kind: 'IMAGE' } } });
  if (q.has.has('video')) attachmentFilters.push({ attachments: { some: { kind: 'VIDEO' } } });
  if (q.has.has('file') || q.has.has('attachment')) attachmentFilters.push({ attachments: { some: {} } });
  if (q.has.has('link')) attachmentFilters.push({ body: { contains: 'http', mode: 'insensitive' } });
  if (attachmentFilters.length) where.AND = attachmentFilters;

  const rows = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { ...messageInclude, channel: { select: { id: true, slug: true, name: true } } },
  });

  return rows.map((m) => ({
    message: toPublicMessage(m, profileId),
    channel: m.channel ? { id: m.channel.id, slug: m.channel.slug, name: m.channel.name } : null,
  }));
}

export const searchService = { searchMessages };
