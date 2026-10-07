import fs from 'node:fs';
import path from 'node:path';
import { DATA_FILE, EARN_VERIFY_EVERY, EARN_VERIFY_PENALTY_MS, EARN_VERIFY_TIMEOUT_MS } from './config.js';

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

function unlockTrophy(user, id, unlocked = null) {
  if (!user.trophies.includes(id)) {
    user.trophies.push(id);
    unlocked?.push(id);
  }
}

function getOrCreate(data, guildId, userId) {
  const key = userKey(guildId, userId);
  data[key] ??= {};
  const user = data[key];
  user.balance ??= 0;
  user.nextEarnAt ??= 0;
  if (!user.earnCooldowns || typeof user.earnCooldowns !== 'object' || Array.isArray(user.earnCooldowns)) user.earnCooldowns = {};
  if (!Number.isInteger(user.earnActionCount) || user.earnActionCount < 0) user.earnActionCount = 0;
  if (!Number.isFinite(user.earnVerificationUntil)) user.earnVerificationUntil = 0;
  if (!Number.isFinite(user.earnBlockedUntil)) user.earnBlockedUntil = 0;
  if (!Array.isArray(user.cards)) user.cards = [];
  if (!Array.isArray(user.trophies)) user.trophies = [];
  user.profileImage ??= null;
  user.profileCardName ??= null;
  user.matchStats ??= { played: 0, wins: 0, draws: 0, losses: 0 };
  if (typeof user.freeClaimed !== 'boolean') user.freeClaimed = false;
  user.workCount ??= 0;
  if (!Array.isArray(user.claimedWorkMilestones)) user.claimedWorkMilestones = [];
  user.dailyStreak ??= 0;
  user.lastDaily ??= null;
  if (!Array.isArray(user.emblems)) user.emblems = [];
  user.team ??= null;
  if (!Array.isArray(user.teams)) user.teams = [user.team ?? null, null, null, null];
  user.teams = user.teams.slice(0, 4);
  while (user.teams.length < 4) user.teams.push(null);
  if (!user.teams[0] && user.team) user.teams[0] = user.team;
  user.team = user.teams[0] ?? null;
  user.unlockedCosmetics ??= {
    frames: ['standard'],
    titles: ['rookie'],
    backgrounds: ['classic'],
  };
  user.cosmetics ??= { frame: 'standard', title: 'rookie', background: 'classic' };
  for (const type of ['frames', 'titles', 'backgrounds']) {
    if (!Array.isArray(user.unlockedCosmetics[type])) user.unlockedCosmetics[type] = ['standard'];
  }
  for (const count of [100, 250, 500]) {
    if (user.workCount >= count) unlockTrophy(user, `work_${count}`);
  }
  if (user.dailyStreak >= 3) unlockTrophy(user, 'daily_3');
  const ownedCount = new Set(user.cards.map((card) => card.name)).size;
  if (ownedCount >= 10) unlockTrophy(user, 'cards_10');
  if (ownedCount >= 25) unlockTrophy(user, 'cards_25');
  if (user.teams.some(Boolean) && !user.trophies.includes('first_team')) unlockTrophy(user, 'first_team');
  return user;
}

export function getUser(guildId, userId) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  writeAll(data);
  return structuredClone(user);
}

export function getSaveBackup() {
  const data = readAll();
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function importSaveBackup(guildId, backup, overwriteExisting = false) {
  if (!guildId || !backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return { ok: false, reason: 'invalid-format' };
  }

  const prefix = String(guildId) + ':';
  const entries = Object.entries(backup).filter(([key]) => key.startsWith(prefix));
  if (!entries.length) return { ok: false, reason: 'no-guild-data' };

  for (const [key, user] of entries) {
    const backupUserId = key.slice(prefix.length);
    if (!/^[0-9]+$/.test(backupUserId) || !user || typeof user !== 'object' || Array.isArray(user)) {
      return { ok: false, reason: 'invalid-format' };
    }
    if (user.balance !== undefined && (!Number.isFinite(user.balance) || user.balance < 0)) {
      return { ok: false, reason: 'invalid-format' };
    }
    if (user.cards !== undefined && !Array.isArray(user.cards)) {
      return { ok: false, reason: 'invalid-format' };
    }
  }

  const data = readAll();
  let imported = 0;
  let replaced = 0;
  let skipped = 0;
  for (const [key, user] of entries) {
    if (Object.hasOwn(data, key)) {
      if (!overwriteExisting) {
        skipped += 1;
        continue;
      }
      replaced += 1;
    } else {
      imported += 1;
    }
    data[key] = structuredClone(user);
  }

  let safetyBackup = null;
  if (imported + replaced > 0) {
    if (replaced > 0) {
      safetyBackup = DATA_FILE + '.' + Date.now() + '-before-import.bak';
      fs.copyFileSync(DATA_FILE, safetyBackup);
    }
    writeAll(data);
  }
  return { ok: true, imported, replaced, skipped, safetyBackup };
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

  if (user.earnVerificationUntil > 0) {
    if (now < user.earnVerificationUntil) {
      return { ok: false, reason: 'verification-pending', nextEarnAt: user.earnVerificationUntil };
    }
    user.earnBlockedUntil = Math.max(user.earnBlockedUntil, user.earnVerificationUntil + EARN_VERIFY_PENALTY_MS);
    user.earnVerificationUntil = 0;
  }
  if (user.earnBlockedUntil > now) {
    writeAll(data);
    return { ok: false, reason: 'verification-failed', nextEarnAt: user.earnBlockedUntil };
  }
  if (user.earnBlockedUntil > 0) user.earnBlockedUntil = 0;

  const nextEarnAt = user.earnCooldowns[activity] ?? 0;
  if (now < nextEarnAt) {
    return { ok: false, reason: 'cooldown', nextEarnAt };
  }

  const actualReward = reward < 0 ? -Math.min(user.balance, Math.abs(reward)) : reward;
  user.balance += actualReward;
  user.earnCooldowns[activity] = now + cooldownMs;
  user.nextEarnAt = Math.min(...Object.values(user.earnCooldowns).filter(Number.isFinite));
  const achievements = [];
  const trophies = [];
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
        unlockTrophy(user, 'work_' + milestone.count, trophies);
      }
    }
  }

  user.earnActionCount += 1;
  const verificationRequired = user.earnActionCount >= EARN_VERIFY_EVERY;
  const verificationUntil = verificationRequired ? now + EARN_VERIFY_TIMEOUT_MS : 0;
  if (verificationRequired) {
    user.earnActionCount = 0;
    user.earnVerificationUntil = verificationUntil;
  }

  writeAll(data);
  return {
    ok: true, balance: user.balance, reward: actualReward, nextEarnAt: user.earnCooldowns[activity],
    workCount: user.workCount, achievements, trophies, verificationRequired, verificationUntil,
  };
}

export function verifyEarnAction(guildId, userId, challengeUntil) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (!Number.isFinite(challengeUntil) || user.earnVerificationUntil !== challengeUntil) {
    return { ok: false, reason: 'stale-challenge' };
  }
  if (Date.now() >= challengeUntil) {
    user.earnVerificationUntil = 0;
    user.earnBlockedUntil = Math.max(user.earnBlockedUntil, challengeUntil + EARN_VERIFY_PENALTY_MS);
    writeAll(data);
    return { ok: false, reason: 'verification-failed', nextEarnAt: user.earnBlockedUntil };
  }
  user.earnVerificationUntil = 0;
  user.earnActionCount = 0;
  writeAll(data);
  return { ok: true };
}
export function claimDailyReward(guildId, userId, dateKey, eventBackground) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (user.lastDaily === dateKey) return { ok: false, reason: 'claimed', streak: user.dailyStreak, balance: user.balance };

  const previousDate = user.lastDaily ? Date.parse(`${user.lastDaily}T00:00:00Z`) : NaN;
  const currentDate = Date.parse(`${dateKey}T00:00:00Z`);
  user.dailyStreak = previousDate === currentDate - 86_400_000 ? Math.min(user.dailyStreak + 1, 3) : 1;
  const reward = [10, 25, 50][user.dailyStreak - 1];
  const trophies = [];
  if (user.dailyStreak >= 3) unlockTrophy(user, 'daily_3', trophies);
  user.lastDaily = dateKey;
  user.balance += reward;
  let unlockedBackground = false;
  if (user.dailyStreak === 3 && eventBackground && !user.unlockedCosmetics.backgrounds.includes(eventBackground)) {
    user.unlockedCosmetics.backgrounds.push(eventBackground);
    unlockedBackground = true;
  }
  writeAll(data);
  return { ok: true, reward, streak: user.dailyStreak, balance: user.balance, unlockedBackground, trophies };
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
  const pulls = [];
  for (const card of cards) {
    if (existingNames.has(card.name)) {
      const coins = duplicateRates[card.tier] ?? 10;
      user.balance += coins;
      const duplicate = { name: card.name, coins, isDuplicate: true };
      duplicates.push(duplicate);
      pulls.push({ ...card, ...duplicate });
    } else {
      existingNames.add(card.name);
      newCards.push({ name: card.name, overall: card.overall, tier: card.tier, obtainedAt });
      pulls.push({ ...card, isDuplicate: false, coins: 0 });
    }
  }
  user.cards.push(...newCards);
  const trophies = [];
  const uniqueCount = new Set(user.cards.map((card) => card.name)).size;
  if (uniqueCount >= 10) unlockTrophy(user, 'cards_10', trophies);
  if (uniqueCount >= 25) unlockTrophy(user, 'cards_25', trophies);
  writeAll(data);
  return { ok: true, balance: user.balance, cards: newCards, duplicates, pulls, trophies, duplicateCoins: duplicates.reduce((sum, card) => sum + card.coins, 0) };
}

const FORMATIONS = new Set(['4-4-2', '4-3-3', '3-5-2']);

export function saveTeam(guildId, userId, formation, playerNames, slotPositions = null, teamSlot = 1) {
  if (!Number.isInteger(teamSlot) || teamSlot < 1 || teamSlot > 4) return { ok: false, reason: 'invalid-slot' };
  if (!FORMATIONS.has(formation) || !Array.isArray(playerNames) || playerNames.length !== 11 || new Set(playerNames).size !== 11) {
    return { ok: false, reason: 'invalid-team' };
  }
  if (slotPositions !== null && (!Array.isArray(slotPositions) || slotPositions.length !== 11)) {
    return { ok: false, reason: 'invalid-team' };
  }
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  const owned = new Set(user.cards.map((card) => card.name));
  if (playerNames.some((name) => !owned.has(name))) return { ok: false, reason: 'not-owned' };
  const trophies = [];
  if (!user.teams.some(Boolean)) unlockTrophy(user, 'first_team', trophies);
  const previous = user.teams[teamSlot - 1] ?? {};
  const savedTeam = { ...previous, formation, players: [...playerNames], ...(slotPositions ? { positions: [...slotPositions] } : {}) };
  user.teams[teamSlot - 1] = savedTeam;
  if (teamSlot === 1) user.team = savedTeam;
  writeAll(data);
  return { ok: true, team: structuredClone(savedTeam), slot: teamSlot, trophies };
}

export function setTeamEmblem(guildId, userId, emblemId, teamSlot = 1) {
  if (!Number.isInteger(teamSlot) || teamSlot < 1 || teamSlot > 4) return { ok: false, reason: 'invalid-slot' };
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  const team = user.teams[teamSlot - 1];
  if (!team) return { ok: false, reason: 'no-team' };
  if (!user.emblems.includes(emblemId)) return { ok: false, reason: 'not-owned' };
  team.emblem = emblemId;
  if (teamSlot === 1) user.team = team;
  writeAll(data);
  return { ok: true, team: structuredClone(team), slot: teamSlot };
}

export function buyEmblemPack(guildId, userId, price, emblemCatalog) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  if (!emblemCatalog.length) return { ok: false, reason: 'no-emblems', balance: user.balance };
  if (user.balance < price) return { ok: false, reason: 'insufficient-funds', balance: user.balance };
  const emblem = emblemCatalog[Math.floor(Math.random() * emblemCatalog.length)];
  const duplicate = user.emblems.includes(emblem.id);
  const duplicateCoins = duplicate ? 10 : 0;
  user.balance -= price;
  if (duplicate) user.balance += duplicateCoins;
  else user.emblems.push(emblem.id);
  writeAll(data);
  return { ok: true, emblem, duplicate, duplicateCoins, balance: user.balance };
}

export function setProfileImage(guildId, userId, imageUrl, cardName = null) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  user.profileImage = imageUrl || null;
  user.profileCardName = cardName || null;
  writeAll(data);
  return structuredClone(user);
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
