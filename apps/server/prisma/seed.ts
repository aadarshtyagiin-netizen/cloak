import 'dotenv/config';
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Production-safe seed. Creates ONLY product catalogs (reaction presets, badges,
 * achievements) and the default community channels. It intentionally creates NO
 * users, profiles, or sample messages — real anonymous identities are minted on
 * first login. Grant admins via the ADMIN_EMAILS env var (see .env.example).
 *
 * Idempotent: safe to run repeatedly (upserts by unique keys).
 */

const REACTION_PRESETS = [
  { key: 'like', emoji: '❤️', label: 'Like', position: 0 },
  { key: 'funny', emoji: '😂', label: 'Funny', position: 1 },
  { key: 'fire', emoji: '🔥', label: 'Fire', position: 2 },
  { key: 'useful', emoji: '💡', label: 'Useful', position: 3 },
  { key: 'claps', emoji: '👏', label: 'Claps', position: 4 },
  { key: 'interesting', emoji: '👀', label: 'Interesting', position: 5 },
  { key: 'excited', emoji: '🚀', label: 'Excited', position: 6 },
];

const BADGES = [
  { key: 'helpful_human', name: 'Helpful Human', emoji: '🏆', description: 'Consistently helps others.', criteria: { peopleHelped: 10 } },
  { key: 'community_regular', name: 'Community Regular', emoji: '🔥', description: 'Shows up and shows love.', criteria: { streakDays: 7 } },
  { key: 'idea_machine', name: 'Idea Machine', emoji: '💡', description: 'Starts great discussions.', criteria: { threadsStarted: 5 } },
  { key: 'gamer', name: 'Gamer', emoji: '🎮', description: 'Lives in #gaming.', criteria: { voiceJoins: 10 } },
  { key: 'knowledge_keeper', name: 'Knowledge Keeper', emoji: '🧠', description: 'Answers the hard questions.', criteria: { answers: 25 } },
  { key: 'early_explorer', name: 'Early Explorer', emoji: '🚀', description: 'Was here from day one.', criteria: { earlyJoin: true } },
  { key: 'meme_lord', name: 'Meme Lord', emoji: '😂', description: 'Certified funny.', criteria: { memeReactions: 100 } },
];

const ACHIEVEMENTS = [
  { key: 'centurion', name: 'Centurion', emoji: '💯', description: 'Send 100 messages.', metric: 'messages_sent', threshold: 100 },
  { key: 'helping_hand', name: 'Helping Hand', emoji: '🤝', description: 'Help 10 people.', metric: 'people_helped', threshold: 10 },
  { key: 'conversation_starter', name: 'Conversation Starter', emoji: '💬', description: 'Start 5 discussions.', metric: 'threads_started', threshold: 5 },
  { key: 'crowd_favorite', name: 'Crowd Favorite', emoji: '🌟', description: 'Receive 100 reactions.', metric: 'reactions_received', threshold: 100 },
  { key: 'voice_regular', name: 'Voice Regular', emoji: '🎧', description: 'Join 10 voice rooms.', metric: 'voice_joins', threshold: 10 },
];

const CHANNELS = [
  { slug: 'general', name: 'general', description: 'Company-wide chatter. Be excellent to each other.', topic: 'Say hi 👋', isSystem: true },
  { slug: 'announcements', name: 'announcements', description: 'Official community announcements.', isSystem: true },
  { slug: 'random', name: 'random', description: 'Off-topic, watercooler, and everything in between.' },
  { slug: 'technology', name: 'technology', description: 'Languages, frameworks, infra, and hot takes.', topic: 'What are you building?' },
  { slug: 'gaming', name: 'gaming', description: 'Squad up. LFG threads welcome.' },
  { slug: 'movies', name: 'movies', description: 'Reviews, recommendations, and spoiler etiquette.' },
  { slug: 'career', name: 'career', description: 'Growth, mentorship, and moving up.' },
  { slug: 'memes', name: 'memes', description: 'Post responsibly. 😂' },
  { slug: 'help', name: 'help', description: 'Stuck on something? Ask here.' },
  { slug: 'confessions', name: 'confessions', description: 'Anonymous, pre-moderated confessions.' },
];

async function main(): Promise<void> {
  console.log('🌱 Seeding Cloak (catalogs + channels only — no fake users)…');

  for (const r of REACTION_PRESETS) {
    await prisma.reactionPreset.upsert({ where: { key: r.key }, update: r, create: r });
  }
  for (const b of BADGES) {
    await prisma.badge.upsert({
      where: { key: b.key },
      update: { name: b.name, emoji: b.emoji, description: b.description, criteria: b.criteria as Prisma.InputJsonValue },
      create: { ...b, criteria: b.criteria as Prisma.InputJsonValue },
    });
  }
  for (const a of ACHIEVEMENTS) {
    await prisma.achievement.upsert({ where: { key: a.key }, update: a, create: a });
  }

  // System-owned channels (no creator profile — they belong to the platform).
  for (const c of CHANNELS) {
    await prisma.channel.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description, topic: c.topic, isSystem: c.isSystem ?? false },
      create: {
        slug: c.slug,
        name: c.name,
        description: c.description,
        topic: c.topic,
        isSystem: c.isSystem ?? false,
        createdByProfileId: null,
      },
    });
  }

  console.log(
    `✅ Seed complete: ${REACTION_PRESETS.length} reactions, ${BADGES.length} badges, ${ACHIEVEMENTS.length} achievements, ${CHANNELS.length} channels.`,
  );
  console.log('   Admins: set ADMIN_EMAILS in the server env, then log in with that email.');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
