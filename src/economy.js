import fs from 'node:fs';
import path from 'node:path';
import { DATA_FILE } from './config.js';

function ensureDataFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}\n', 'utf8');
}

function readAll() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Nie mogę odczytać ${DATA_FILE}: ${error.message}`);
  }
}

function writeAll(data) {
  ensureDataFile();
  const temporary = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, DATA_FILE);
}

function userKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getOrCreate(data, guildId, userId) {
  const key = userKey(guildId, userId);
  data[key] ??= {};
  const user = data[key];
  user.balance ??= 0;
  user.nextEarnAt ??= 0;
  if (!Array.isArray(user.cards)) user.cards = [];
  if (typeof user.freeClaimed !== 'boolean') user.freeClaimed = false;
  user.workCount ??= 0;
  if (!Array.isArray(user.claimedWorkMilestones)) user.claimedWorkMilestones = [];
  user.dailyStreak ??= 0;
  user.lastDaily ??= null;
  if (!Array.isArray(user.emblems)) user.emblems = [];
  user.team ??= null;
  user.unlockedCosmetics ??= {
    frames: ['standard'],
    titles: ['rookie'],
    backgrounds: ['classic'],
  };
  user.cosmetics ??= { frame: 'standard', title: 'rookie', background: 'classic' };
  for (const type of ['frames', 'titles', 'backgrounds']) {
    if (!Array.isArray(user.unlockedCosmetics[type])) user.unlockedCosmetics[type] = ['standard'];
  }
  return user;
}

export function getUser(guildId, userId) {
  const data = readAll();
  return structuredClone(getOrCreate(data, guildId, userId));
}

export function getSaveBackup() {
  const data = readAll();
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const WORK_MILESTONES = [
  { count: 100, reward: 200, frame: 'bronze', title: 'hardworker', background: 'raimon' },
  { count: 250, reward: 350, frame: 'silver', title: 'hissatsu_hunter', background: 'zeus' },
  { count: 500, reward: 700, frame: 'gold', title: 'inazuma_legend', background: 'genesis' },
];

export function claimReward(guildId, userId, reward, cooldownMs, activity) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  const now = Date.now();
  if (now < user.nextEarnAt) {
    return { ok: false, balance: user.balance, nextEarnAt: user.nextEarnAt };
  }
  user.balance += reward;
  user.nextEarnAt = now + cooldownMs;
  const achievements = [];
  if (activity === 'work') {
    user.workCount += 1;
    for (const milestone of WORK_MILESTONES) {
      if (user.workCount === milestone.count && !user.claimedWorkMilestones.includes(milestone.count)) {
        user.claimedWorkMilestones.push(milestone.count);
        user.balance += milestone.reward;
        for (const [type, id] of Object.entries({ frame: milestone.frame, title: milestone.title, background: milestone.background })) {
          const listName = type === 'frame' ? 'frames' : type === 'title' ? 'titles' : 'backgrounds';
          if (!user.unlockedCosmetics[listName].includes(id)) user.unlockedCosmetics[listName].push(id);
        }
        achievements.push({ count: milestone.count, reward: milestone.reward });
      }
    }
  }
  writeAll(data);
  return { ok: true, balance: user.balance, nextEarnAt: user.nextEarnAt, workCount: user.workCount, achievements };
}

export function claimDailyReward(guildId, userId, dateKey, eventBackground) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (user.lastDaily === dateKey) return { ok: false, reason: 'claimed', streak: user.dailyStreak, balance: user.balance };

  const previousDate = user.lastDaily ? Date.parse(`${user.lastDaily}T00:00:00Z`) : NaN;
  const currentDate = Date.parse(`${dateKey}T00:00:00Z`);
  user.dailyStreak = previousDate === currentDate - 86_400_000 ? Math.min(user.dailyStreak + 1, 3) : 1;
  const reward = [10, 25, 50][user.dailyStreak - 1];
  user.lastDaily = dateKey;
  user.balance += reward;
  let unlockedBackground = false;
  if (user.dailyStreak === 3 && eventBackground && !user.unlockedCosmetics.backgrounds.includes(eventBackground)) {
    user.unlockedCosmetics.backgrounds.push(eventBackground);
    unlockedBackground = true;
  }
  writeAll(data);
  return { ok: true, reward, streak: user.dailyStreak, balance: user.balance, unlockedBackground };
}

export function claimFreeReward(guildId, userId, reward) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (user.freeClaimed) return { ok: false, balance: user.balance };
  user.balance += reward;
  user.freeClaimed = true;
  writeAll(data);
  return { ok: true, balance: user.balance };
}

export function buyPack(guildId, userId, price, cards) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (user.balance < price) return { ok: false, balance: user.balance };
  user.balance -= price;
  const obtainedAt = new Date().toISOString();
  const existingNames = new Set(user.cards.map((card) => card.name));
  const duplicateRates = { BRĄZOWA: 10, SREBRNA: 20, ZŁOTA: 30 };
  const newCards = [];
  const duplicates = [];
  for (const card of cards) {
    if (existingNames.has(card.name)) {
      const coins = duplicateRates[card.tier] ?? 10;
      user.balance += coins;
      duplicates.push({ name: card.name, coins });
    } else {
      existingNames.add(card.name);
      newCards.push({ name: card.name, overall: card.overall, tier: card.tier, obtainedAt });
    }
  }
  user.cards.push(...newCards);
  writeAll(data);
  return { ok: true, balance: user.balance, cards: newCards, duplicates, duplicateCoins: duplicates.reduce((sum, card) => sum + card.coins, 0) };
}

const FORMATIONS = new Set(['4-4-2', '4-3-3', '3-5-2']);

export function saveTeam(guildId, userId, formation, playerNames) {
  if (!FORMATIONS.has(formation) || !Array.isArray(playerNames) || playerNames.length !== 11 || new Set(playerNames).size !== 11) {
    return { ok: false, reason: 'invalid-team' };
  }
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  const owned = new Set(user.cards.map((card) => card.name));
  if (playerNames.some((name) => !owned.has(name))) return { ok: false, reason: 'not-owned' };
  user.team = { ...(user.team ?? {}), formation, players: playerNames };
  writeAll(data);
  return { ok: true, team: structuredClone(user.team) };
}

export function setTeamEmblem(guildId, userId, emblemId) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (!user.team) return { ok: false, reason: 'no-team' };
  if (!user.emblems.includes(emblemId)) return { ok: false, reason: 'not-owned' };
  user.team.emblem = emblemId;
  writeAll(data);
  return { ok: true, team: structuredClone(user.team) };
}

export function buyEmblemPack(guildId, userId, price, emblemCatalog) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  const available = emblemCatalog.filter((emblem) => !user.emblems.includes(emblem.id));
  if (!available.length) return { ok: false, reason: 'all-owned', balance: user.balance };
  if (user.balance < price) return { ok: false, reason: 'insufficient-funds', balance: user.balance };
  const emblem = available[Math.floor(Math.random() * available.length)];
  user.balance -= price;
  user.emblems.push(emblem.id);
  writeAll(data);
  return { ok: true, emblem, balance: user.balance };
}

export function setCosmetic(guildId, userId, type, value) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  const listName = type === 'frame' ? 'frames' : type === 'title' ? 'titles' : type === 'background' ? 'backgrounds' : null;
  if (!listName || !user.unlockedCosmetics[listName].includes(value)) return { ok: false };
  user.cosmetics[type] = value;
  writeAll(data);
  return { ok: true, user: structuredClone(user) };
}

const RED_ROULETTE_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function playRoulette(guildId, userId, stake, chosenColor) {
  if (!Number.isInteger(stake) || stake < 1 || stake > 100) {
    return { ok: false, reason: 'invalid-stake' };
  }
  if (!['red', 'black'].includes(chosenColor)) {
    return { ok: false, reason: 'invalid-color' };
  }

  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (user.balance < stake) {
    return { ok: false, reason: 'insufficient-funds', balance: user.balance };
  }

  const number = Math.floor(Math.random() * 37);
  const color = number === 0 ? 'green' : RED_ROULETTE_NUMBERS.has(number) ? 'red' : 'black';
  const won = color === chosenColor;
  user.balance -= stake;
  const payout = won ? stake * 2 : 0;
  user.balance += payout;
  writeAll(data);
  return { ok: true, won, number, color, payout, balance: user.balance };
}
