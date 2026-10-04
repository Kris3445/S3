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

const rarityColors = {
  BRĄZOWA: '#c07042',
  SREBRNA: '#c3d8e8',
  ZŁOTA: '#ffbe37',
};

const rarityDarkColors = {
  BRĄZOWA: '#46291f',
  SREBRNA: '#344457',
  ZŁOTA: '#493b1d',
};

function tierFor(player) {
  if (player.overall >= 75) return 'ZŁOTA';
  if (player.overall >= 65) return 'SREBRNA';
  return 'BRĄZOWA';
}

export async function renderCollection(catalog, ownedCards) {
  const owned = new Set(ownedCards.map((card) => card.name));
  const rows = Math.ceil(catalog.length / COLUMNS);
  const height = TOP + rows * TILE_HEIGHT + (rows - 1) * GAP_Y + 42;
  const canvas = createCanvas(WIDTH, height);
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
    ctx.strokeStyle = isOwned ? accent : '#505967';
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 2.5, y + 2.5, TILE_WIDTH - 5, TILE_HEIGHT - 5);
    ctx.save();
    if (!isOwned) ctx.filter = 'grayscale(1) brightness(0.48)';
    ctx.drawImage(image, x + 6, y + 6, TILE_WIDTH - 12, IMAGE_HEIGHT - 8);
    ctx.restore();

    ctx.fillStyle = isOwned ? rarityDarkColors[tier] : '#202938';
    ctx.fillRect(x + 5, y + IMAGE_HEIGHT, TILE_WIDTH - 10, TILE_HEIGHT - IMAGE_HEIGHT - 5);
    ctx.fillStyle = isOwned ? accent : '#596273';
    ctx.fillRect(x + 5, y + IMAGE_HEIGHT, TILE_WIDTH - 10, 4);
    ctx.fillStyle = isOwned ? '#f2f5fb' : '#8993a3';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(player.name, x + 9, y + IMAGE_HEIGHT + 27, TILE_WIDTH - 18);
    ctx.fillStyle = isOwned ? accent : '#7a8493';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`OVERALL ${player.overall}  •  ${tier}`, x + 9, y + IMAGE_HEIGHT + 50, TILE_WIDTH - 18);

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

export async function renderPlayerCard(player) {
  const tier = tierFor(player);
  const accent = rarityColors[tier];
  const canvas = createCanvas(640, 820);
  const ctx = canvas.getContext('2d');
  const image = await loadImage(path.join(ASSETS, player.image));

  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, accent);
  gradient.addColorStop(0.5, rarityDarkColors[tier]);
  gradient.addColorStop(1, accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(20, 20, 600, 780);
  ctx.fillStyle = '#0d192a';
  ctx.fillRect(32, 32, 576, 756);
  ctx.drawImage(image, 42, 42, 556, 600);
  ctx.fillStyle = rarityDarkColors[tier];
  ctx.fillRect(42, 642, 556, 136);
  ctx.fillStyle = accent;
  ctx.fillRect(42, 642, 556, 7);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 38px Arial';
  ctx.fillText(player.name, 62, 700, 516);
  ctx.fillStyle = accent;
  ctx.font = 'bold 26px Arial';
  ctx.fillText(`OVERALL ${player.overall}  •  ${tier}`, 62, 748, 516);
  return canvas.encode('png');
}

function emblemSource(emblem) {
  const crop = emblem.crop;
  return crop
    ? [crop.x, crop.y, crop.width, crop.height]
    : null;
}

function drawEmblem(ctx, image, emblem, x, y, width, height) {
  const crop = emblemSource(emblem);
  const source = crop ?? [0, 0, image.width, image.height];
  const aspect = source[2] / source[3];
  let drawWidth = width;
  let drawHeight = width / aspect;
  if (drawHeight > height) {
    drawHeight = height;
    drawWidth = height * aspect;
  }
  const dx = x + (width - drawWidth) / 2;
  const dy = y + (height - drawHeight) / 2;
  ctx.drawImage(image, ...source, dx, dy, drawWidth, drawHeight);
}

export async function renderEmblemCard(emblem) {
  const canvas = createCanvas(640, 820);
  const ctx = canvas.getContext('2d');
  const image = await loadImage(path.join(ASSETS, emblem.image));
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = emblem.color;
  ctx.fillRect(20, 20, 600, 780);
  ctx.fillStyle = '#0d192a';
  ctx.fillRect(32, 32, 576, 756);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(54, 62, 532, 536);
  drawEmblem(ctx, image, emblem, 72, 82, 496, 496);
  ctx.fillStyle = '#111c2e';
  ctx.fillRect(42, 622, 556, 156);
  ctx.fillStyle = emblem.color;
  ctx.fillRect(42, 622, 556, 7);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 22px Arial';
  ctx.fillText('HERB DRUŻYNY', 62, 675, 516);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 40px Arial';
  ctx.fillText(emblem.name, 62, 735, 516);
  return canvas.encode('png');
}

export async function renderEmblemPackPreview(emblems) {
  const canvas = createCanvas(1200, 460);
  const ctx = canvas.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, '#081426');
  background.addColorStop(1, '#252043');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 34px Arial';
  ctx.fillText('HISSATSU PACK  •  HERBY SZKÓŁ', 42, 52);
  const cardWidth = 330;
  for (let index = 0; index < emblems.length; index += 1) {
    const emblem = emblems[index];
    const image = await loadImage(path.join(ASSETS, emblem.image));
    const x = 42 + index * 382;
    ctx.fillStyle = '#111c2e';
    ctx.fillRect(x, 78, cardWidth, 340);
    ctx.strokeStyle = emblem.color;
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 3, 81, cardWidth - 6, 334);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 28, 98, cardWidth - 56, 250);
    drawEmblem(ctx, image, emblem, x + 45, 110, cardWidth - 90, 226);
    ctx.fillStyle = '#f4f6fb';
    ctx.font = 'bold 25px Arial';
    ctx.fillText(emblem.name, x + 28, 389, cardWidth - 56);
  }
  return canvas.encode('png');
}

export async function renderProfileBanner(username, user, profileOptions) {
  const canvas = createCanvas(1200, 440);
  const ctx = canvas.getContext('2d');
  const backgrounds = {
    classic: ['#0b1220', '#24364f'],
    raimon: ['#102846', '#c57c18'],
    zeus: ['#132b1b', '#83a933'],
    genesis: ['#1e1535', '#7751b8'],
  };
  const [start, end] = backgrounds[user.cosmetics.background] ?? backgrounds.classic;
  const frame = profileOptions.frames[user.cosmetics.frame] ?? profileOptions.frames.standard;
  const frameColor = typeof frame.color === 'number'
    ? `#${frame.color.toString(16).padStart(6, '0')}`
    : frame.color;
  const title = profileOptions.titles[user.cosmetics.title]?.name ?? 'Nowy zawodnik';
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
    ctx.beginPath();
    ctx.moveTo(i * 180, 0);
    ctx.lineTo(i * 180 + 130, 0);
    ctx.lineTo(i * 180 - 60, canvas.height);
    ctx.lineTo(i * 180 - 190, canvas.height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = 14;
  ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px Arial';
  ctx.fillText(username, 72, 150, 1050);
  ctx.fillStyle = frameColor;
  ctx.font = 'bold 34px Arial';
  ctx.fillText(title, 74, 216, 1000);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = '26px Arial';
  const uniqueCardCount = new Set(user.cards.map((card) => card.name)).size;
  ctx.fillText(`${uniqueCardCount} kart  •  ${user.balance} monet`, 74, 300);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '20px Arial';
  ctx.fillText(`Tło: ${profileOptions.backgrounds[user.cosmetics.background]?.name ?? 'Klasyczne'}`, 74, 365);
  return canvas.encode('png');
}
