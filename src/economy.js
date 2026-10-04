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
  if (!data[key]) data[key] = { balance: 0, nextEarnAt: 0, cards: [], freeClaimed: false };
  if (!Array.isArray(data[key].cards)) data[key].cards = [];
  if (typeof data[key].freeClaimed !== 'boolean') data[key].freeClaimed = false;
  return data[key];
}

export function getUser(guildId, userId) {
  const data = readAll();
  return structuredClone(getOrCreate(data, guildId, userId));
}

export function claimReward(guildId, userId, reward, cooldownMs) {
  const data = readAll();
  const user = getOrCreate(data, guildId, userId);
  const now = Date.now();
  if (now < user.nextEarnAt) {
    return { ok: false, balance: user.balance, nextEarnAt: user.nextEarnAt };
  }
  user.balance += reward;
  user.nextEarnAt = now + cooldownMs;
  writeAll(data);
  return { ok: true, balance: user.balance, nextEarnAt: user.nextEarnAt };
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
  const newCards = cards.map((card) => ({
    name: card.name,
    overall: card.overall,
    tier: card.tier,
    obtainedAt,
  }));
  user.cards.push(...newCards);
  writeAll(data);
  return { ok: true, balance: user.balance, cards: newCards };
}
