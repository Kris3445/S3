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

export const PACK_PRICE = 100;
export const EMBLEM_PACK_PRICE = 50;
export const EARN_REWARD = 20;
export const GLOBAL_COOLDOWN_MS = 60_000;
export const PACK_SIZE = 5;
export const BETA_END_AT = Date.parse('2026-10-07T21:21:26+02:00');
