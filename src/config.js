import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const ASSETS = path.join(ROOT, 'assets');
// Set DATA_FILE to a file on your host's persistent volume to keep progress across deployments.
const configuredDataFile = process.env.DATA_FILE?.trim();
export const DATA_FILE = configuredDataFile
  ? path.resolve(configuredDataFile)
  : path.join(ROOT, 'data', 'users.json');

export const TOKEN = process.env.DISCORD_TOKEN;
export const CLIENT_ID = process.env.CLIENT_ID;
export const GUILD_ID = process.env.GUILD_ID || '';

export const PACK_PRICE = 125;
export const EMBLEM_PACK_PRICE = 50;
export const WORK_MIN_REWARD = 5;
export const WORK_MAX_REWARD = 10;
export const WORK_COOLDOWN_MS = 30_000;
export const TRAINING_MIN_REWARD = 10;
export const TRAINING_MAX_REWARD = 25;
export const TRAINING_COOLDOWN_MS = 120_000;
export const JOB_MIN_REWARD = 25;
export const JOB_MAX_REWARD = 30;
export const JOB_LOSS_MIN = 5;
export const JOB_LOSS_MAX = 10;
export const JOB_COOLDOWN_MS = 300_000;
export const EARN_VERIFY_EVERY = 8;
export const EARN_VERIFY_TIMEOUT_MS = 60_000;
export const EARN_VERIFY_PENALTY_MS = 180_000;
export const HISSATSU_CHALLENGE_COOLDOWN_MS = 120_000;
export const HISSATSU_CHALLENGE_TIMEOUT_MS = 15_000;
export const PACK_SIZE = 5;
export const BETA_END_AT = Date.parse('2026-10-07T21:21:26+02:00');
