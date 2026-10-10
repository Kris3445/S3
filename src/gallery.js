import path from 'node:path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { ASSETS } from './config.js';
import { hissatsuPower, hissatsuTpCost } from './match.js';

const ROBOTO_FONT = path.join(ASSETS, 'fonts', 'Roboto-Variable.ttf');
if (!GlobalFonts.registerFromPath(ROBOTO_FONT, 'Roboto')) {
  throw new Error(`Nie udało się załadować czcionki Roboto: ${ROBOTO_FONT}`);
}

const WIDTH = 1160;
const COLUMNS = 4;
const MARGIN = 44;
const GAP_X = 20;
const GAP_Y = 24;
const TILE_WIDTH = (WIDTH - MARGIN * 2 - GAP_X * (COLUMNS - 1)) / COLUMNS;
const IMAGE_HEIGHT = TILE_WIDTH * (900 / 640);
const TILE_HEIGHT = IMAGE_HEIGHT;
const TOP = 180;

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

const elementColors = {
  Wind: '#39c9d6',
  Fire: '#f07a45',
  Forest: '#70bd74',
  Mountain: '#c6a267',
};

const elementNames = {
  Wind: 'WIATR',
  Fire: 'OGIEŃ',
  Forest: 'LAS',
  Mountain: 'GÓRA',
};

function tierFor(player) {
  if (player.overall >= 75) return 'ZŁOTA';
  if (player.overall >= 65) return 'SREBRNA';
  return 'BRĄZOWA';
}

export async function renderCollection(catalog, ownedCards, page = 0, teamEmblems = []) {
  const owned = new Set(ownedCards.map((card) => card.name));
  const pageCount = Math.max(1, ...catalog.map((player) => player.collection_page ?? 1));
  const pageCatalog = catalog.filter((player) => (player.collection_page ?? 1) === page + 1);
  const rows = Math.max(1, Math.ceil(pageCatalog.length / COLUMNS));
  const height = TOP + rows * TILE_HEIGHT + (rows - 1) * GAP_Y + 42;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, WIDTH, height);
  const teamName = pageCatalog[0]?.team;
  const teamEmblem = teamName
    ? teamEmblems.find((entry) => entry.name.toLocaleLowerCase('pl') === teamName.toLocaleLowerCase('pl'))
    : null;
  if (teamEmblem) {
    // Prominent club header: a large crest and an explicit team label.
    ctx.fillStyle = '#111c2e';
    ctx.fillRect(28, 16, WIDTH - 56, 104);
    ctx.lineWidth = 2;
    ctx.strokeStyle = teamEmblem.color;
    ctx.strokeRect(29, 17, WIDTH - 58, 102);
    ctx.beginPath();
    ctx.arc(82, 68, 48, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = teamEmblem.color;
    ctx.stroke();
    const emblemImage = await loadImage(path.join(ASSETS, teamEmblem.image));
    drawEmblem(ctx, emblemImage, teamEmblem, 38, 24, 88, 88);
    ctx.fillStyle = '#f2f5fb';
    ctx.font = 'bold 38px Roboto';
    ctx.fillText(`DRUŻYNA: ${teamName.toUpperCase()}`, 154, 65);
    ctx.fillStyle = teamEmblem.color;
    ctx.font = 'bold 16px Roboto';
    ctx.fillText(`KOLEKCJA  •  STRONA ${page + 1}/${pageCount}`, 156, 94);
  } else {
    ctx.fillStyle = '#f2f5fb';
    ctx.font = 'bold 30px Roboto';
    ctx.fillText(`INAZUMA ELEVEN  •  ${page + 1}/${pageCount}`, MARGIN, 55);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px Roboto';
  const collectionCountX = teamEmblem ? 154 : MARGIN;
  ctx.fillText(`${owned.size}/${catalog.length} ZAWODNIKÓW`, collectionCountX, 112);

  const legendY = 148;
  let legendX = MARGIN;
  for (const [tier, color] of Object.entries(rarityColors)) {
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 10, 13, 13);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px Roboto';
    ctx.fillText(tier, legendX + 20, legendY + 1);
    legendX += tier === 'SREBRNA' ? 125 : 118;
  }

  for (let index = 0; index < pageCatalog.length; index += 1) {
    const player = pageCatalog[index];
    const x = MARGIN + (index % COLUMNS) * (TILE_WIDTH + GAP_X);
    const y = TOP + Math.floor(index / COLUMNS) * (TILE_HEIGHT + GAP_Y);
    const isOwned = owned.has(player.name);
    // Gray out only the portrait. Filtering the whole card made its OVERALL
    // and name unreadable for players who had not unlocked it yet.
    const cardImage = await loadImage(await renderPlayerCard(player, { locked: !isOwned }));
    ctx.drawImage(cardImage, x, y, TILE_WIDTH, TILE_HEIGHT);
  }

  return canvas.encode('png');
}

export async function renderPlayerCard(player, { locked = false } = {}) {
  const tier = tierFor(player);
  const accent = rarityColors[tier];
  const canvas = createCanvas(640, 900);
  const ctx = canvas.getContext('2d');
  const image = await loadImage(path.join(ASSETS, player.image));

  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // A single restrained frame layout is shared by all players. Only the
  // rarity accent changes, so every card keeps the same dimensions.
  ctx.fillStyle = accent;
  ctx.fillRect(18, 18, 604, 864);
  ctx.fillStyle = '#101a2a';
  ctx.fillRect(26, 26, 588, 848);

  // Small rarity header
  ctx.fillStyle = rarityDarkColors[tier];
  ctx.fillRect(34, 34, 572, 52);
  ctx.fillStyle = accent;
  ctx.fillRect(34, 82, 572, 4);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 22px Roboto';
  ctx.textAlign = 'center';
  ctx.fillText(tier, 320, 67);
  ctx.textAlign = 'left';

  // All catalog portraits use the same 4:5 image ratio, avoiding stretching.
  ctx.save();
  if (locked) ctx.filter = 'grayscale(1) brightness(0.62)';
  if (player.portrait_zoom && player.portrait_zoom > 1) {
    const zoom = Number(player.portrait_zoom);
    const sourceWidth = image.width / zoom;
    const sourceHeight = image.height / zoom;
    const focusX = Math.min(1, Math.max(0, Number(player.portrait_focus_x ?? 0.5)));
    const focusY = Math.min(1, Math.max(0, Number(player.portrait_focus_y ?? 0.5)));
    const sourceX = Math.min(image.width - sourceWidth, Math.max(0, image.width * focusX - sourceWidth / 2));
    const sourceY = Math.min(image.height - sourceHeight, Math.max(0, image.height * focusY - sourceHeight / 2));
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 40, 94, 560, 700);
  } else {
    ctx.drawImage(image, 40, 94, 560, 700);
  }
  ctx.restore();

  // Draw all card information last on a fully opaque footer. Explicitly reset
  // the canvas state so portrait filters cannot hide the overall or the name.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = '#111c2e';
  ctx.fillRect(34, 794, 572, 72);
  ctx.fillStyle = accent;
  ctx.fillRect(34, 794, 572, 4);

  ctx.beginPath();
  ctx.arc(86, 830, 38, 0, Math.PI * 2);
  ctx.fillStyle = '#0b1220';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = accent;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px Roboto';
  ctx.fillText('OVR', 86, 808);
  ctx.font = 'bold 34px Roboto';
  ctx.fillText(String(player.overall ?? '—'), 86, 840);

  const cardName = String(player.name ?? 'ZAWODNIK').trim().toLocaleUpperCase('pl');
  const nameFontSize = cardName.length > 16 ? 27 : 31;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${nameFontSize}px Roboto`;
  ctx.fillText(cardName, 140, 819, 306);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 17px Roboto';
  ctx.fillText(String(player.position ?? '').toLocaleUpperCase('pl'), 142, 848, 300);

  ctx.fillStyle = '#40516a';
  ctx.fillRect(464, 808, 2, 44);
  const elementColor = elementColors[player.element] ?? '#cbd5e1';
  ctx.beginPath();
  ctx.arc(488, 830, 8, 0, Math.PI * 2);
  ctx.fillStyle = elementColor;
  ctx.fill();
  ctx.fillStyle = elementColor;
  ctx.font = 'bold 14px Roboto';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(elementNames[player.element] ?? String(player.element ?? '').toLocaleUpperCase('pl'), 502, 830, 96);
  return canvas.encode('png');
}

export async function renderScoutStats(player) {
  // Tall, portrait report: identity and portrait first, attributes in the
  // middle, then techniques with power and TP in right-hand columns.
  const width = 1000;
  const height = 1620;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const tier = tierFor(player);
  const accent = rarityColors[tier] ?? '#63c7dc';
  const accentDark = rarityDarkColors[tier] ?? '#173747';
  const image = await loadImage(path.join(ASSETS, player.image));
  const team = String(player.team ?? 'INAZUMA ELEVEN').toUpperCase();
  const position = String(player.position ?? 'Zawodnik').toUpperCase();
  const element = elementNames[player.element] ?? String(player.element ?? '—').toUpperCase();
  const stats = player.stats ?? {};

  ctx.fillStyle = '#08111d';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0d1a2a';
  ctx.fillRect(20, 20, width - 40, height - 40);
  ctx.fillStyle = '#101f32';
  ctx.fillRect(42, 42, width - 84, height - 84);
  ctx.fillStyle = accent;
  ctx.fillRect(42, 42, width - 84, 8);

  ctx.fillStyle = '#95a6bb';
  ctx.font = 'bold 16px Roboto';
  ctx.fillText('RAPORT ZAWODNIKA  /  INAZUMA ELEVEN', 72, 91);
  ctx.fillStyle = '#f7f9fc';
  ctx.font = 'bold 43px Roboto';
  ctx.fillText(player.name.toUpperCase(), 72, 151, 690);
  ctx.fillStyle = '#b8c5d5';
  ctx.font = 'bold 19px Roboto';
  ctx.fillText(`${position}   •   ${element}   •   ${tier}`, 74, 187, 700);

  ctx.fillStyle = accentDark;
  ctx.beginPath();
  ctx.roundRect(818, 65, 112, 126, 14);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#d4deea';
  ctx.font = 'bold 13px Roboto';
  ctx.textAlign = 'center';
  ctx.fillText('OVERALL', 874, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 50px Roboto';
  ctx.fillText(String(player.overall), 874, 157);
  ctx.textAlign = 'left';

  // Contain the source image, keeping every character at its original ratio.
  const imageBox = { x: 72, y: 220, w: 856, h: 520 };
  const scale = Math.min(imageBox.w / image.width, imageBox.h / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h, 12);
  ctx.clip();
  ctx.fillStyle = '#16263a';
  ctx.fillRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h);
  ctx.drawImage(image, imageBox.x + (imageBox.w - drawW) / 2, imageBox.y + (imageBox.h - drawH) / 2, drawW, drawH);
  ctx.restore();
  ctx.strokeStyle = '#304258';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h, 12);
  ctx.stroke();

  ctx.fillStyle = '#0a1422';
  ctx.fillRect(72, 758, 856, 74);
  ctx.fillStyle = accentDark;
  ctx.fillRect(72, 758, 6, 74);
  ctx.fillStyle = '#91a3b8';
  ctx.font = 'bold 14px Roboto';
  ctx.fillText('DRUŻYNA', 96, 786);
  ctx.fillStyle = '#f3f6fa';
  ctx.font = 'bold 23px Roboto';
  ctx.fillText(team, 96, 816, 800);

  ctx.fillStyle = '#8fa0b5';
  ctx.font = 'bold 15px Roboto';
  ctx.fillText('PARAMETRY ZAWODNIKA', 72, 878);
  ctx.fillStyle = '#1d2d42';
  ctx.fillRect(72, 891, 856, 2);

  const attributes = [
    ['GUARD', stats.guard], ['STAMINA', stats.stamina],
    ['BODY', stats.body], ['TP', stats.tp],
    ['INTELLIGENCE', stats.intelligence], ['CONTROL', stats.control],
    ['KICK', stats.kick], ['SPEED', stats.speed],
  ];
  const colW = 400;
  const xPositions = [72, 528];
  const startY = 929;
  const rowGap = 68;
  for (let index = 0; index < attributes.length; index += 1) {
    const [label, rawValue] = attributes[index];
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = xPositions[col];
    const y = startY + row * rowGap;
    const value = Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0;
    const max = label === 'TP' ? 180 : 100;
    ctx.fillStyle = '#c5d0de';
    ctx.font = 'bold 14px Roboto';
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px Roboto';
    ctx.textAlign = 'right';
    ctx.fillText(String(value), x + colW, y + 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#22344a';
    ctx.beginPath();
    ctx.roundRect(x, y + 16, colW, 9, 5);
    ctx.fill();
    ctx.fillStyle = label === 'TP' ? '#60bdd2' : accent;
    ctx.beginPath();
    ctx.roundRect(x, y + 16, Math.max(4, colW * Math.min(1, Math.max(0, value / max))), 9, 5);
    ctx.fill();
  }

  const moves = (player.hissatsu ?? []).slice(0, 3);
  const moveTitleY = 1208;
  ctx.fillStyle = '#8fa0b5';
  ctx.font = 'bold 15px Roboto';
  ctx.fillText('HISSATSU', 72, moveTitleY);
  ctx.fillStyle = '#1d2d42';
  ctx.fillRect(72, moveTitleY + 12, 856, 2);
  ctx.fillStyle = '#8fa0b5';
  ctx.font = 'bold 12px Roboto';
  ctx.textAlign = 'center';
  ctx.fillText('MOC', 795, moveTitleY);
  ctx.fillText('TP', 882, moveTitleY);
  ctx.textAlign = 'left';

  if (moves.length === 0) {
    ctx.fillStyle = '#c5d0de';
    ctx.font = '17px Roboto';
    ctx.fillText('Brak przypisanych technik.', 72, 1265);
  }
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    const y = 1240 + index * 108;
    const moveElement = elementColors[move.element] ?? '#8ba0b7';
    ctx.fillStyle = '#0b1726';
    ctx.beginPath();
    ctx.roundRect(72, y, 856, 88, 8);
    ctx.fill();
    ctx.fillStyle = moveElement;
    ctx.fillRect(72, y, 5, 88);
    ctx.fillStyle = '#f0f4f9';
    ctx.font = 'bold 20px Roboto';
    ctx.fillText(move.name, 96, y + 37, 590);
    ctx.fillStyle = '#bac7d6';
    ctx.font = '15px Roboto';
    const moveKind = [move.type, move.element].filter(Boolean).join('  •  ');
    ctx.fillText(moveKind || 'Technika', 96, y + 65, 590);

    const power = hissatsuPower(player);
    const tp = hissatsuTpCost(power);
    ctx.fillStyle = accentDark;
    ctx.beginPath();
    ctx.roundRect(748, y + 16, 94, 56, 8);
    ctx.roundRect(851, y + 16, 62, 56, 8);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.font = 'bold 23px Roboto';
    ctx.textAlign = 'center';
    ctx.fillText(String(power), 795, y + 52);
    ctx.fillStyle = '#60bdd2';
    ctx.fillText(String(tp), 882, y + 52);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#75869b';
  ctx.font = '12px Roboto';
  const seasonLabel = player.stat_source
    ? `STATYSTYKI ${player.stat_source}`
    : player.stat_seasons ? `SEZONY ${player.stat_seasons}` : 'STATYSTYKI SEZONOWE';
  ctx.fillText(`${seasonLabel.toUpperCase()}  •  TP W SKALI MECZOWEJ`, 72, 1580);
  return canvas.encode('png');
}
export async function renderPlayerComparison(first, second) {
  const width = 1200;
  const height = 1040;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#08111d';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0d1a2a';
  ctx.fillRect(20, 20, width - 40, height - 40);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 32px Roboto';
  ctx.textAlign = 'center';
  ctx.fillText('PORÓWNANIE ZAWODNIKÓW', width / 2, 74);
  ctx.textAlign = 'left';

  const cards = [{ player: first, x: 40 }, { player: second, x: 620 }];
  for (const { player, x } of cards) {
    const tier = tierFor(player);
    const accent = rarityColors[tier] ?? '#63c7dc';
    const panelWidth = 540;
    ctx.fillStyle = '#101f32';
    ctx.fillRect(x, 100, panelWidth, 900);
    ctx.fillStyle = accent;
    ctx.fillRect(x, 100, panelWidth, 7);
    ctx.fillStyle = '#f7f9fc';
    ctx.font = 'bold 27px Roboto';
    ctx.fillText(player.name.toUpperCase(), x + 22, 145, 390);
    ctx.fillStyle = accent;
    ctx.font = 'bold 18px Roboto';
    ctx.textAlign = 'right';
    ctx.fillText(`OVR ${player.overall}`, x + panelWidth - 22, 145);
    ctx.textAlign = 'left';

    const image = await loadImage(path.join(ASSETS, player.image));
    const box = { x: x + 22, y: 170, w: panelWidth - 44, h: 292 };
    const scale = Math.min(box.w / image.width, box.h / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    ctx.fillStyle = '#16263a';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.drawImage(image, box.x + (box.w - drawW) / 2, box.y + (box.h - drawH) / 2, drawW, drawH);

    const stats = player.stats ?? {};
    const rows = [
      ['KICK', stats.kick], ['BODY', stats.body], ['CONTROL', stats.control],
      ['GUARD', stats.guard], ['SPEED', stats.speed], ['STAMINA', stats.stamina],
      ['TP', stats.tp], ['INTELLIGENCE', stats.intelligence],
    ];
    ctx.fillStyle = '#8fa0b5';
    ctx.font = 'bold 13px Roboto';
    ctx.fillText('STATYSTYKA', x + 24, 494);
    ctx.textAlign = 'right';
    ctx.fillText('WARTOŚĆ', x + panelWidth - 24, 494);
    ctx.textAlign = 'left';
    for (let index = 0; index < rows.length; index += 1) {
      const [label, raw] = rows[index];
      const value = Number.isFinite(Number(raw)) ? Number(raw) : 0;
      const y = 510 + index * 58;
      ctx.fillStyle = '#13243a';
      ctx.beginPath();
      ctx.roundRect(x + 20, y, panelWidth - 40, 48, 7);
      ctx.fill();
      ctx.fillStyle = '#c5d0de';
      ctx.font = 'bold 16px Roboto';
      ctx.fillText(label, x + 34, y + 30);
      ctx.fillStyle = '#8fa0b5';
      ctx.font = '13px Roboto';
      ctx.fillText(String(player.position ?? ''), x + 155, y + 30, 180);
      const otherValue = Number(player === first ? second.stats?.[label.toLowerCase()] : first.stats?.[label.toLowerCase()]);
      ctx.fillStyle = !Number.isFinite(otherValue) || value === otherValue
        ? '#f7f9fc'
        : value > otherValue ? '#59d890' : '#f0787f';
      ctx.font = 'bold 21px Roboto';
      ctx.textAlign = 'right';
      ctx.fillText(String(value), x + panelWidth - 34, y + 31);
      ctx.textAlign = 'left';
    }
  }

  ctx.fillStyle = '#75869b';
  ctx.font = '13px Roboto';
  ctx.textAlign = 'center';
  ctx.fillText('Porównanie statystyk zawodników', width / 2, 1020);
  ctx.textAlign = 'left';
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
  ctx.fillStyle = '#15243a';
  ctx.fillRect(54, 62, 532, 536);
  drawEmblem(ctx, image, emblem, 72, 82, 496, 496);
  ctx.fillStyle = '#111c2e';
  ctx.fillRect(42, 622, 556, 156);
  ctx.fillStyle = emblem.color;
  ctx.fillRect(42, 622, 556, 7);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 22px Roboto';
  ctx.fillText('HERB DRUŻYNY', 62, 675, 516);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 40px Roboto';
  ctx.fillText(emblem.name, 62, 735, 516);
  return canvas.encode('png');
}

export async function renderEmblemPackPreview(emblems) {
  const canvas = createCanvas(1200, 480);
  const ctx = canvas.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, '#081426');
  background.addColorStop(1, '#252043');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 30px Roboto';
  ctx.fillText('HISSATSU PACK  •  HERBY SZKÓŁ', 42, 52);
  const cardWidth = 260;
  const cardHeight = 350;
  const gap = 20;
  const left = (canvas.width - (emblems.length * cardWidth + Math.max(0, emblems.length - 1) * gap)) / 2;
  for (let index = 0; index < emblems.length; index += 1) {
    const emblem = emblems[index];
    const image = await loadImage(path.join(ASSETS, emblem.image));
    const x = left + index * (cardWidth + gap);
    ctx.fillStyle = '#111c2e';
    ctx.fillRect(x, 78, cardWidth, cardHeight);
    ctx.strokeStyle = emblem.color;
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 3, 81, cardWidth - 6, cardHeight - 6);
    ctx.fillStyle = '#15243a';
    ctx.fillRect(x + 18, 96, cardWidth - 36, 210);
    drawEmblem(ctx, image, emblem, x + 28, 106, cardWidth - 56, 190);
    ctx.fillStyle = '#f4f6fb';
    ctx.font = 'bold 20px Roboto';
    ctx.textAlign = 'center';
    ctx.fillText(emblem.name.toUpperCase(), x + cardWidth / 2, 352, cardWidth - 28);
    ctx.textAlign = 'left';
  }
  return canvas.encode('png');
}

export async function renderSquadPitch(lineup, formation, emblem = null) {
  const canvas = createCanvas(1200, 980);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 28px Roboto';
  ctx.fillText(`TEAM SQUAD  •  ${formation}`, 36, 52);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px Roboto';
  ctx.fillText('SKŁAD ZAPISANY', 38, 79);

  // Team information panel, styled after the compact crest and OVR column
  // in the supplied squad builder reference.
  ctx.fillStyle = '#111c2e';
  ctx.fillRect(34, 108, 198, 810);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(35, 109, 196, 808);
  if (emblem) {
    const image = await loadImage(path.join(ASSETS, emblem.image));
    drawEmblem(ctx, image, emblem, 70, 150, 126, 126);
  } else {
    ctx.beginPath();
    ctx.arc(133, 213, 48, 0, Math.PI * 2);
    ctx.fillStyle = '#168cff';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Roboto';
    ctx.textAlign = 'center';
    ctx.fillText('IE', 133, 221);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 14px Roboto';
  ctx.textAlign = 'center';
  ctx.fillText(emblem?.name?.toUpperCase() ?? 'TWOJA DRUŻYNA', 133, 309, 170);
  const avgOverall = Math.round(lineup.reduce((sum, entry) => sum + entry.player.overall, 0) / lineup.length);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(68, 360, 130, 104);
  ctx.strokeStyle = '#475569';
  ctx.strokeRect(68, 360, 130, 104);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px Roboto';
  ctx.fillText('ŚREDNIE OVR', 133, 386);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 34px Roboto';
  ctx.fillText(String(avgOverall), 133, 433);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px Roboto';
  ctx.fillText(`${lineup.length} ZAWODNIKÓW`, 133, 505);
  ctx.textAlign = 'left';

  // Vertical pitch with all cards at the same dimensions.
  const px = 270;
  const py = 108;
  const pw = 895;
  const ph = 810;
  ctx.fillStyle = '#125322';
  ctx.fillRect(px, py, pw, ph);
  for (let band = 0; band < 10; band += 1) {
    if (band % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(px, py + band * (ph / 10), pw, ph / 10);
    }
  }
  ctx.strokeStyle = 'rgba(230,255,235,0.72)';
  ctx.lineWidth = 3;
  ctx.strokeRect(px + 8, py + 8, pw - 16, ph - 16);
  ctx.beginPath();
  ctx.moveTo(px + 8, py + ph / 2);
  ctx.lineTo(px + pw - 8, py + ph / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + ph / 2, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + ph / 2, 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(230,255,235,0.8)';
  ctx.fill();
  for (const top of [true, false]) {
    const boxY = top ? py + 8 : py + ph - 8 - 178;
    ctx.strokeRect(px + 214, boxY, pw - 428, 170);
    const smallY = top ? py + 8 : py + ph - 8 - 64;
    ctx.strokeRect(px + 310, smallY, pw - 620, 56);
  }

  const rows = [
    { position: 'Napastnik', y: 0.19 },
    { position: 'Pomocnik', y: 0.40 },
    { position: 'Obrońca', y: 0.63 },
    { position: 'Bramkarz', y: 0.83 },
  ];
  const cardW = 118;
  const cardH = cardW * 900 / 640;
  const xsByCount = {
    1: [0.5], 2: [0.35, 0.65], 3: [0.2, 0.5, 0.8],
    4: [0.14, 0.38, 0.62, 0.86],
    5: [0.1, 0.3, 0.5, 0.7, 0.9],
  };
  for (const row of rows) {
    const members = lineup.filter((entry) => entry.position === row.position);
    const slots = xsByCount[members.length] ?? members.map((_, i) => (i + 1) / (members.length + 1));
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const card = await loadImage(await renderPlayerCard(member.player));
      const cx = px + slots[index] * pw;
      const cy = py + row.y * ph;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.drawImage(card, cx - cardW / 2, cy - cardH / 2, cardW, cardH);
      ctx.restore();
    }
  }
  return canvas.encode('png');
}

export async function renderSquadBuilderPreview(formation, selectedPlayers = []) {
  const canvas = createCanvas(1200, 980);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 28px Roboto';
  ctx.fillText(`BUDOWANIE SKŁADU  •  ${formation}`, 36, 52);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '15px Roboto';
  ctx.fillText('WYBIERZ 11 KART Z KOLEKCJI', 38, 79);
  ctx.fillStyle = '#111c2e';
  ctx.fillRect(34, 108, 198, 810);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.strokeRect(35, 109, 196, 808);
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 14px Roboto';
  ctx.textAlign = 'center';
  ctx.fillText('TRYB', 133, 170);
  ctx.fillText('BUDOWANIA', 133, 194);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 38px Roboto';
  ctx.fillText('11', 133, 284);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px Roboto';
  ctx.fillText('MIEJSC W SKŁADZIE', 133, 312);
  ctx.fillText('Wybierz piłkarzy', 133, 365);
  ctx.fillText('z menu poniżej.', 133, 389);

  const px = 270;
  const py = 108;
  const pw = 895;
  const ph = 810;
  ctx.fillStyle = '#125322';
  ctx.fillRect(px, py, pw, ph);
  for (let band = 0; band < 10; band += 1) {
    if (band % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(px, py + band * (ph / 10), pw, ph / 10);
    }
  }
  ctx.strokeStyle = 'rgba(230,255,235,0.72)';
  ctx.lineWidth = 3;
  ctx.strokeRect(px + 8, py + 8, pw - 16, ph - 16);
  ctx.beginPath();
  ctx.moveTo(px + 8, py + ph / 2);
  ctx.lineTo(px + pw - 8, py + ph / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px + pw / 2, py + ph / 2, 78, 0, Math.PI * 2);
  ctx.stroke();
  for (const top of [true, false]) {
    const boxY = top ? py + 8 : py + ph - 8 - 178;
    ctx.strokeRect(px + 214, boxY, pw - 428, 170);
    const smallY = top ? py + 8 : py + ph - 8 - 64;
    ctx.strokeRect(px + 310, smallY, pw - 620, 56);
  }
  const [defenders, midfielders, forwards] = formation.split('-').map(Number);
  const groups = [
    { label: 'FW', position: 'Napastnik', count: forwards, y: 0.19 },
    { label: 'MF', position: 'Pomocnik', count: midfielders, y: 0.40 },
    { label: 'DF', position: 'Obrońca', count: defenders, y: 0.63 },
    { label: 'GK', position: 'Bramkarz', count: 1, y: 0.83 },
  ];
  const cardW = 118;
  const cardH = cardW * 900 / 640;
  const xsByCount = { 1: [0.5], 2: [0.35, 0.65], 3: [0.2, 0.5, 0.8], 4: [0.14, 0.38, 0.62, 0.86], 5: [0.1, 0.3, 0.5, 0.7, 0.9] };
  for (const group of groups) {
    const xs = xsByCount[group.count] ?? Array.from({ length: group.count }, (_, i) => (i + 1) / (group.count + 1));
    const members = selectedPlayers.filter((player) => player.squadPosition === group.position);
    for (let index = 0; index < xs.length; index += 1) {
      const cx = px + xs[index] * pw;
      const cy = py + group.y * ph;
      const x = cx - cardW / 2;
      const y = cy - cardH / 2;
      const player = members[index];
      if (player) {
        const card = await loadImage(await renderPlayerCard(player));
        ctx.drawImage(card, x, y, cardW, cardH);
      } else {
        ctx.fillStyle = '#17263a';
        ctx.fillRect(x, y, cardW, cardH);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, cardW - 3, cardH - 3);
        ctx.beginPath();
        ctx.arc(cx, y + 55, 22, 0, Math.PI * 2);
        ctx.fillStyle = '#263950';
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 15px Roboto';
        ctx.fillText(group.label, cx, y + cardH - 22);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Roboto';
        ctx.fillText('PUSTE MIEJSCE', cx, y + cardH - 7);
      }
    }
  }
  ctx.textAlign = 'left';
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
  ctx.font = 'bold 54px Roboto';
  ctx.fillText(username, 72, 150, 1050);
  ctx.fillStyle = frameColor;
  ctx.font = 'bold 34px Roboto';
  ctx.fillText(title, 74, 216, 1000);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = '26px Roboto';
  const uniqueCardCount = new Set(user.cards.map((card) => card.name)).size;
  ctx.fillText(`${uniqueCardCount} kart  •  ${user.balance} monet`, 74, 300);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '20px Roboto';
  ctx.fillText(`Tło: ${profileOptions.backgrounds[user.cosmetics.background]?.name ?? 'Klasyczne'}`, 74, 365);
  return canvas.encode('png');
}


export async function renderMatchPitch({home,away,homeCarrier,awayCarrier,phase,zone=1}) {
  const width=1120, height=760, canvas=createCanvas(width,height), ctx=canvas.getContext('2d');
  ctx.fillStyle='#0b1118'; ctx.fillRect(0,0,width,height);
  const head=ctx.createLinearGradient(0,0,width,0);
  head.addColorStop(0,'#122334'); head.addColorStop(.5,'#172a34'); head.addColorStop(1,'#281d22');
  ctx.fillStyle=head; ctx.fillRect(0,0,width,100);
  ctx.fillStyle='#aab6bf'; ctx.font='bold 15px Roboto'; ctx.textAlign='center';
  ctx.fillText('MECZ  •  NA ŻYWO',width/2,25);
  ctx.fillStyle='#eef3f6'; ctx.font='bold 26px Roboto';
  ctx.textAlign='left'; ctx.fillText('TWOJA DRUŻYNA',52,67);
  ctx.textAlign='right'; ctx.fillText('OCCULT',width-52,67);
  ctx.fillStyle='#283b4b'; ctx.beginPath(); ctx.roundRect(width/2-70,35,140,52,11); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='bold 29px Roboto'; ctx.textAlign='center';
  const score=arguments[0].score||{home:0,away:0};
  ctx.fillText(String(score.home)+' : '+String(score.away),width/2,70);
  ctx.fillStyle='#c4d0d7'; ctx.font='bold 14px Roboto';
  ctx.fillText(String(arguments[0].minute||0)+'′',width/2,96);
  const field={x:28,y:112,w:width-56,h:476};
  ctx.fillStyle='#24633c'; ctx.fillRect(field.x,field.y,field.w,field.h);
  for(let n=0;n<10;n++) if(n%2===0){ctx.fillStyle='rgba(205,255,218,.055)';ctx.fillRect(field.x+n*field.w/10,field.y,field.w/10,field.h);}
  ctx.strokeStyle='rgba(239,249,239,.78)';ctx.lineWidth=2;
  ctx.strokeRect(field.x+4,field.y+4,field.w-8,field.h-8);
  ctx.beginPath();ctx.moveTo(width/2,field.y+4);ctx.lineTo(width/2,field.y+field.h-4);ctx.stroke();
  ctx.beginPath();ctx.arc(width/2,field.y+field.h/2,64,0,Math.PI*2);ctx.stroke();
  const centerY=field.y+field.h/2;
  for(const left of [true,false]){
    const edge=left?field.x+4:field.x+field.w-4;
    ctx.strokeRect(left?edge:edge-116,centerY-84,116,168);
    ctx.strokeRect(left?edge:edge-48,centerY-41,48,82);
  }
  const xPos={home:{Bramkarz:.055,Obrońca:.20,Pomocnik:.37,Napastnik:.48},away:{Bramkarz:.945,Obrońca:.80,Pomocnik:.63,Napastnik:.52}};
  const colors={home:'#278cf0',away:'#e65350'};
  function drawTeam(team,side,carrierName){
    const groups=new Map();for(const p of team){const role=p.position||'Pomocnik';if(!groups.has(role))groups.set(role,[]);groups.get(role).push(p);}
    let number=1;
    for(const role of ['Bramkarz','Obrońca','Pomocnik','Napastnik']){
      const players=groups.get(role)||[];
      for(let idx=0;idx<players.length;idx++){
        const p=players[idx];let x=field.x+field.w*xPos[side][role],y=field.y+field.h*(idx+1)/(players.length+1);
        const hasBall=p.name===carrierName;
        if(hasBall){
          const push=Math.max(0,Math.min(2,zone-1))*.115;
          x=field.x+field.w*(side==='home'?.49+push:.51-push);
          y=centerY+(side==='home'?-18:18);
          ctx.beginPath();ctx.arc(x,y,20,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();
        }
        ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fillStyle=colors[side];ctx.fill();
        ctx.strokeStyle='#f4f6f8';ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle='#fff';ctx.font='bold 9px Roboto';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(number),x,y);
        if(hasBall){ctx.beginPath();ctx.arc(x+(side==='home'?19:-19),y+14,7,0,Math.PI*2);ctx.fillStyle='#f6e6ad';ctx.fill();ctx.strokeStyle='#18222a';ctx.lineWidth=1.5;ctx.stroke();}
        number++;
      }
    }
  }
  drawTeam(home,'home',homeCarrier);drawTeam(away,'away',awayCarrier);
  ctx.fillStyle='#121a22';ctx.fillRect(28,600,width-56,132);
  ctx.fillStyle=phase==='home'?'#64b8ff':'#ff8b82';ctx.beginPath();ctx.roundRect(46,616,5,100,2);ctx.fill();
  ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#eef3f6';ctx.font='bold 17px Roboto';
  const zoneNames=['środek boiska','środek boiska','przedpole','pole karne'];
  const minute=arguments[0].minute||0, poss=arguments[0].possession||'';
  ctx.fillText(String(minute)+'′  ·  PIŁKA: '+poss+'  ·  '+zoneNames[Math.max(0,Math.min(3,zone))],65,642,width-130);
  ctx.fillStyle='#cad3da';ctx.font='15px Roboto';
  const action=arguments[0].footer||arguments[0].lastAction||'Mecz w toku.';
  const words=String(action).replace(/[*]/g,'').split(/\s+/);let row='',y=672,lines=0;
  for(const word of words){const trial=row?row+' '+word:word;if(ctx.measureText(trial).width>width-130&&row){ctx.fillText(row,65,y);row=word;y+=20;lines++;if(lines>=2)break;}else row=trial;}
  if(row&&lines<3)ctx.fillText(row,65,y,width-130);
  ctx.fillStyle='#81909c';ctx.font='12px Roboto';ctx.textAlign='right';
  ctx.fillText(String(score.home)+' : '+String(score.away)+'  ·  '+(arguments[0].teamName||'Twoja drużyna')+' — '+(arguments[0].awayName||'Occult'),width-44,722,480);
  ctx.textAlign='left';ctx.textBaseline='alphabetic';return canvas.encode('png');
}
