import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { ASSETS } from './config.js';

const WIDTH = 1160;
const COLUMNS = 4;
const MARGIN = 44;
const GAP_X = 20;
const GAP_Y = 24;
const TILE_WIDTH = (WIDTH - MARGIN * 2 - GAP_X * (COLUMNS - 1)) / COLUMNS;
const IMAGE_HEIGHT = TILE_WIDTH * 1.25;
const TILE_HEIGHT = IMAGE_HEIGHT + 72;
const TOP = 156;
const ROWS = 4;
const HEIGHT = TOP + ROWS * TILE_HEIGHT + (ROWS - 1) * GAP_Y + 42;

const rarityColors = {
  BRĄZOWA: '#c07042',
  SREBRNA: '#c3d8e8',
  ZŁOTA: '#ffbe37',
};

function tierFor(player) {
  if (player.overall >= 75) return 'ZŁOTA';
  if (player.overall >= 65) return 'SREBRNA';
  return 'BRĄZOWA';
}

export async function renderCollection(catalog, ownedCards) {
  const owned = new Set(ownedCards.map((card) => card.name));
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#f2f5fb';
  ctx.font = 'bold 30px Arial';
  ctx.fillText('INAZUMA ELEVEN S2  •  ZAWODNICY', MARGIN, 55);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '17px Arial';
  ctx.fillText(`${owned.size} / ${catalog.length} ZAWODNIKÓW ODBLOKOWANYCH`, MARGIN, 88);

  const legendY = 122;
  let legendX = MARGIN;
  for (const [tier, color] of Object.entries(rarityColors)) {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 10, 13, 13);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px Arial';
    ctx.fillText(tier, legendX + 20, legendY + 1);
    legendX += tier === 'SREBRNA' ? 125 : 118;
  }

  for (let index = 0; index < catalog.length; index += 1) {
    const player = catalog[index];
    const x = MARGIN + (index % COLUMNS) * (TILE_WIDTH + GAP_X);
    const y = TOP + Math.floor(index / COLUMNS) * (TILE_HEIGHT + GAP_Y);
    const isOwned = owned.has(player.name);
    const tier = tierFor(player);
    const accent = rarityColors[tier];
    const imagePath = path.join(ASSETS, player.image);
    const image = await loadImage(imagePath);

    ctx.fillStyle = '#111c2e';
    ctx.fillRect(x, y, TILE_WIDTH, TILE_HEIGHT);
    ctx.save();
    if (!isOwned) ctx.filter = 'grayscale(1) brightness(0.48)';
    ctx.drawImage(image, x, y, TILE_WIDTH, IMAGE_HEIGHT);
    ctx.restore();

    ctx.fillStyle = isOwned ? accent : '#596273';
    ctx.fillRect(x, y + IMAGE_HEIGHT, TILE_WIDTH, 4);
    ctx.fillStyle = isOwned ? '#f2f5fb' : '#8993a3';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(player.name, x + 2, y + IMAGE_HEIGHT + 27, TILE_WIDTH - 4);
    ctx.fillStyle = isOwned ? accent : '#7a8493';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`OVERALL ${player.overall}  •  ${tier}`, x + 2, y + IMAGE_HEIGHT + 50, TILE_WIDTH - 4);

    const badge = isOwned ? 'MAM' : 'NIE MASZ';
    ctx.font = 'bold 11px Arial';
    const badgeWidth = ctx.measureText(badge).width + 16;
    ctx.fillStyle = isOwned ? '#117c5b' : '#4b5563';
    ctx.fillRect(x + TILE_WIDTH - badgeWidth - 8, y + 8, badgeWidth, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(badge, x + TILE_WIDTH - badgeWidth, y + 24);
  }

  return canvas.encode('png');
}
