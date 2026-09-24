import { randomInt } from 'node:crypto';
import { randomToken } from '../../lib/crypto.js';

/**
 * Anonymous identity generator: <Adjective><Noun><NN> e.g. "BlueFox42",
 * "SilentNinja17", "PixelPanda81". Word lists are curated to be friendly and
 * non-identifying. Rules (cooldown, max/day) live in identity.service.
 */
const ADJECTIVES = [
  'Blue', 'Silent', 'Pixel', 'Quiet', 'Swift', 'Cosmic', 'Hidden', 'Neon', 'Lunar', 'Solar',
  'Frost', 'Ember', 'Shadow', 'Golden', 'Crimson', 'Velvet', 'Turbo', 'Mellow', 'Wild', 'Brave',
  'Clever', 'Witty', 'Zen', 'Rogue', 'Mystic', 'Rapid', 'Fuzzy', 'Cyber', 'Retro', 'Amber',
  'Jade', 'Ivory', 'Onyx', 'Nimble', 'Stellar', 'Dapper', 'Groovy', 'Sunny', 'Misty', 'Electric',
];

const NOUNS = [
  'Fox', 'Ninja', 'Panda', 'Wolf', 'Falcon', 'Otter', 'Tiger', 'Raven', 'Koala', 'Lynx',
  'Dragon', 'Phoenix', 'Badger', 'Heron', 'Comet', 'Yak', 'Puma', 'Owl', 'Bison', 'Gecko',
  'Mantis', 'Walrus', 'Hawk', 'Orca', 'Cobra', 'Moose', 'Robin', 'Sloth', 'Viper', 'Crane',
  'Bear', 'Seal', 'Hedgehog', 'Marmot', 'Narwhal', 'Quokka', 'Ferret', 'Pangolin', 'Meerkat', 'Axolotl',
];

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length)]!;
}

export interface GeneratedIdentity {
  username: string;
  avatarSeed: string;
}

/** Generate a candidate anonymous identity (uniqueness enforced by the caller). */
export function randomUsername(): GeneratedIdentity {
  const username = `${pick(ADJECTIVES)}${pick(NOUNS)}${randomInt(10, 100)}`;
  return { username, avatarSeed: randomToken(6) };
}

/** Deterministic avatar seed for a given string (used when uploading is not chosen). */
export function avatarSeedFor(username: string): string {
  return username;
}
