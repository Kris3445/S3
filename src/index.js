import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  ASSETS,
  BETA_END_AT,
  EARN_REWARD,
  EMBLEM_PACK_PRICE,
  GLOBAL_COOLDOWN_MS,
  PACK_PRICE,
  PACK_SIZE,
  TOKEN,
} from './config.js';
import {
  buyEmblemPack,
  buyPack,
  claimDailyReward,
  claimFreeReward,
  claimReward,
  getSaveBackup,
  getUser,
  playRoulette,
  saveTeam,
  setCosmetic,
  setTeamEmblem,
} from './economy.js';
import { renderCollection, renderPlayerCard, renderProfileBanner, renderSquadBuilderPreview, renderSquadPitch } from './gallery.js';

if (!TOKEN) {
  console.error('Brakuje DISCORD_TOKEN. Skopiuj .env.example do .env i uzupełnij token.');
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(path.join(ASSETS, 'katalog.json'), 'utf8'));
const emblems = JSON.parse(fs.readFileSync(path.join(ASSETS, 'emblems.json'), 'utf8'));
for (const player of catalog) {
  if (!player.image || !fs.existsSync(path.join(ASSETS, player.image))) {
    console.error(`Brakuje zdjęcia zawodnika ${player.name}: assets/${player.image ?? '(brak ścieżki)'}`);
    process.exit(1);
  }
}
for (const emblem of emblems) {
  if (!emblem.image || !fs.existsSync(path.join(ASSETS, emblem.image))) {
    console.error(`Brakuje herbu ${emblem.name}: assets/${emblem.image ?? '(brak ścieżki)'}`);
    process.exit(1);
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const FREE_REWARD = 8000;
const OPENING_ANIMATION_MS = 3800;
const CARD_REVEAL_DELAY_MS = 1400;

const tierColors = {
  'BRĄZOWA': 0xc07042,
  'SREBRNA': 0xc3d8e8,
  'ZŁOTA': 0xffbe37,
};

function requireGuild(interaction) {
  if (interaction.guildId) return true;
  interaction.reply({ content: 'Użyj tej komendy na serwerze Discord.', ephemeral: true });
  return false;
}

async function requireAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  await interaction.reply({
    content: '⛔ Tylko administrator serwera może używać komend tego bota.',
    ephemeral: true,
  });
  return false;
}

function isModerator(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) return true;
  const roles = interaction.member?.roles?.cache;
  return Boolean(roles?.some((role) => /moderator|moderat|^mod(?:\b|[ _.-])/i.test(role.name)));
}

async function requireGameAccess(interaction) {
  if (Date.now() < BETA_END_AT || isModerator(interaction)) return true;
  await interaction.reply({
    content: '🔒 Otwarta beta skończyła się 7 października. Teraz komendy gry są dostępne tylko dla moderatorów.',
    ephemeral: true,
  });
  return false;
}

function randomPlayer() {
  const total = catalog.reduce((sum, player) => sum + player.chance_percent, 0);
  let roll = Math.random() * total;
  for (const player of catalog) {
    roll -= player.chance_percent;
    if (roll < 0) return player;
  }
  return catalog.at(-1);
}

function drawPack() {
  return Array.from({ length: PACK_SIZE }, randomPlayer);
}

function animationFor(cards) {
  const bestOverall = Math.max(...cards.map((card) => card.overall));
  if (bestOverall >= 75) return 'animacja_paczki_zlota.gif';
  if (bestOverall >= 65) return 'animacja_paczki_srebrna.gif';
  return 'animacja_paczki_bronzowa.gif';
}

function cardEmbed(card, index, imageName, duplicateCoins = 0) {
  const embed = new EmbedBuilder()
    .setColor(tierColors[card.tier] ?? 0x5b8cff)
    .setTitle(`${card.name}  •  OVERALL ${card.overall}`)
    .setDescription(`Rzadkość: **${card.tier}**${duplicateCoins ? `\n↩️ Duplikat zamieniony na **${duplicateCoins} monet**.` : ''}`)
    .setImage(`attachment://${imageName}`)
    .setFooter({ text: `Karta ${index + 1}/${PACK_SIZE} • Inazuma Eleven S2` });
  return embed;
}

async function showShop(interaction, page = 0, edit = false) {
  const emblemPage = page === 1;
  const imageName = emblemPage ? 'hissatsu_pack.png' : 'paczka_s2.png';
  const avatarName = 'hissatsu_pack_avatar.png';
  const emblemNames = emblems.map((entry) => entry.name).join(', ');
  const herbCommand = '/herb';
  const embed = emblemPage
    ? new EmbedBuilder()
      .setColor(0x9868e8)
      .setTitle('✨ Hissatsu Pack — herby szkół')
      .setDescription(`Paczka daje **1 nowy herb** spośród ${emblemNames}.\nCena: **${EMBLEM_PACK_PRICE} monet**. Herbem możesz oznaczyć swój skład przez \`${herbCommand}\`.`)
      .setImage(`attachment://${imageName}`)
      .setFooter({ text: 'Przełącz paczki strzałkami poniżej.' })
    : new EmbedBuilder()
      .setColor(0x168cff)
      .setTitle('⚡ Sklep Inazuma Eleven — paczka S2')
      .setDescription(`Jedna paczka zawiera **${PACK_SIZE} zawodników**.\nCena: **${PACK_PRICE} monet**\n\nDuplikaty zamieniają się na monety: brąz 10, srebro 20, złoto 30.`)
      .setImage(`attachment://${imageName}`)
      .setFooter({ text: 'Zarabiaj przez /work, /training lub /job albo odbierz jednorazowe /free.' });
  if (emblemPage) embed.setThumbnail(`attachment://${avatarName}`);

  const previous = new ButtonBuilder().setCustomId('shop-prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(!emblemPage);
  const buy = new ButtonBuilder()
    .setCustomId(emblemPage ? 'buy-hissatsu-pack' : 'buy-player-pack')
    .setLabel(emblemPage ? `Kup Hissatsu Pack — ${EMBLEM_PACK_PRICE}` : `Kup paczkę — ${PACK_PRICE}`)
    .setEmoji('🎁')
    .setStyle(ButtonStyle.Primary);
  const next = new ButtonBuilder().setCustomId('shop-next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(emblemPage);
  const row = new ActionRowBuilder().addComponents(previous, buy, next);
  const image = new AttachmentBuilder(path.join(ASSETS, imageName));
  const files = [image];
  if (emblemPage) files.push(new AttachmentBuilder(path.join(ASSETS, avatarName)));
  const payload = { embeds: [embed], components: [row], files };
  if (edit) payload.attachments = [];
  if (edit) await interaction.update(payload);
  else await interaction.reply(payload);
}

async function earn(interaction, activity) {
  if (!requireGuild(interaction)) return;
  const activityKey = activity === 'wykonuje pracę' ? 'work' : activity;
  const result = claimReward(interaction.guildId, interaction.user.id, EARN_REWARD, GLOBAL_COOLDOWN_MS, activityKey);
  if (!result.ok) {
    const timestamp = Math.ceil(result.nextEarnAt / 1000);
    await interaction.reply({
      content: `Masz wspólną przerwę na zarabianie. Spróbuj ponownie <t:${timestamp}:R>.`,
      ephemeral: true,
    });
    return;
  }
  const achievementText = result.achievements.map((achievement) => `🏅 Osiągnięcie ${achievement.count} użyć /work: **+${achievement.reward} monet** i nowe ozdoby profilu!`).join('\n');
  const progress = activityKey === 'work' ? ` Postęp /work: **${result.workCount}**.` : '';
  await interaction.reply({
    content: `💰 ${interaction.user} ${activity}. Dostajesz **${EARN_REWARD} monet**.${progress}\n${achievementText}\nMasz teraz **${result.balance} monet**. Następna praca za minutę.`,
    ephemeral: true,
  });
}

async function openPack(interaction) {
  if (!requireGuild(interaction)) return;
  const cards = drawPack();
  const result = buyPack(interaction.guildId, interaction.user.id, PACK_PRICE, cards);
  if (!result.ok) {
    await interaction.reply({
      content: `Masz **${result.balance} monet**, a paczka kosztuje **${PACK_PRICE}**. Zarób więcej przez /work, /training lub /job.`,
      ephemeral: true,
    });
    return;
  }

  const animationName = animationFor(cards);
  const animation = new AttachmentBuilder(path.join(ASSETS, animationName));
  const duplicateQueue = [...result.duplicates];
  await interaction.reply({
    content: `🎁 ${interaction.user} otwiera paczkę S2!${result.duplicateCoins ? ` Duplikaty dały **${result.duplicateCoins} monet**.` : ''} Pozostało **${result.balance} monet**.`,
    files: [animation],
  });

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const delay = index === 0 ? OPENING_ANIMATION_MS : CARD_REVEAL_DELAY_MS;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const imageName = `zawodnik-${index + 1}.png`;
    const renderedCard = await renderPlayerCard(card);
    const duplicateIndex = duplicateQueue.findIndex((duplicate) => duplicate.name === card.name);
    const duplicate = duplicateIndex >= 0 ? duplicateQueue.splice(duplicateIndex, 1)[0] : null;
    await interaction.followUp({
      content: index === 0 ? '⚡ Zawodnicy z paczki pojawiają się po kolei:' : undefined,
      embeds: [cardEmbed(card, index, imageName, duplicate?.coins ?? 0)],
      files: [new AttachmentBuilder(Buffer.from(renderedCard), { name: imageName })],
    });
  }
}

async function claimFree(interaction) {
  if (!requireGuild(interaction)) return;
  const result = claimFreeReward(interaction.guildId, interaction.user.id, FREE_REWARD);
  if (!result.ok) {
    await interaction.reply({ content: 'Odebrałeś już jednorazowe **8000 monet**.', ephemeral: true });
    return;
  }
  await interaction.reply(`🎁 ${interaction.user}, odbierasz **${FREE_REWARD} darmowych monet**! Masz teraz **${result.balance} monet**.`);
}

async function showCollection(interaction, page = 0, edit = false) {
  if (!edit && !requireGuild(interaction)) return;
  const user = getUser(interaction.guildId, interaction.user.id);
  const pageCount = Math.max(1, ...catalog.map((player) => player.collection_page ?? 1));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const image = await renderCollection(catalog, user.cards, safePage, emblems);
  const imageName = 'kolekcja-s2.png';
  const embed = new EmbedBuilder()
    .setColor(0x168cff)
    .setTitle(`⚽ Kolekcja S2 — ${interaction.user.username} · strona ${safePage + 1}/${pageCount}`)
    .setDescription(`Masz **${new Set(user.cards.map((card) => card.name)).size} z ${catalog.length}** zawodników. Szare karty nie są jeszcze w Twojej kolekcji.`)
    .setImage(`attachment://${imageName}`);
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`collection-page:${safePage - 1}`).setLabel('◀ Poprzednia').setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`collection-page:${safePage + 1}`).setLabel('Następna ▶').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pageCount - 1),
  );
  const payload = {
    embeds: [embed],
    files: [new AttachmentBuilder(Buffer.from(image), { name: imageName })],
    components: [controls],
  };
  if (edit) await interaction.update(payload);
  else await interaction.reply({ ...payload, ephemeral: true });
}

async function showStats(interaction) {
  if (!requireGuild(interaction)) return;
  const name = interaction.options.getString('zawodnik', true);
  const player = catalog.find((entry) => entry.name === name);
  if (!player) {
    await interaction.reply({ content: 'Nie znaleziono tego zawodnika.', ephemeral: true });
    return;
  }

  const user = getUser(interaction.guildId, interaction.user.id);
  const owned = user.cards.some((card) => card.name === player.name);
  const hissatsu = (player.hissatsu ?? []).map((move) => {
    const element = move.element ? ` · ${move.element}` : '';
    return `• **${move.name}** — ${move.type}${element}`;
  });
  const embed = new EmbedBuilder()
    .setColor(tierColors[player.tier] ?? 0x168cff)
    .setTitle(`⚽ ${player.name} · OVERALL ${player.overall}`)
    .setDescription(owned ? '✅ Masz tego zawodnika w kolekcji.' : '🔒 Nie masz jeszcze tej karty.')
    .addFields(
      { name: 'Pozycja', value: player.position ?? 'Niepodana', inline: true },
      { name: 'Element', value: player.element ?? 'Niepodany', inline: true },
      { name: 'Rzadkość', value: player.tier, inline: true },
      { name: 'Hissatsu', value: hissatsu.length ? hissatsu.join('\n') : 'Nie podano technik.' },
    );
  const imageName = 'karta-zawodnika.png';
  embed.setImage(`attachment://${imageName}`);
  const cardImage = await renderPlayerCard(player, { locked: !owned });
  await interaction.reply({
    embeds: [embed],
    files: [new AttachmentBuilder(Buffer.from(cardImage), { name: imageName })],
    ephemeral: true,
  });
}

async function sendSave(interaction) {
  if (!requireGuild(interaction)) return;
  const date = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const backup = new AttachmentBuilder(getSaveBackup(), { name: `inazuma-save-${date}.json` });
  try {
    await interaction.user.send({
      content: `📦 Kopia zapisu serwera **${interaction.guild.name}**. Zawiera monety, karty, drużyny, herby i postępy. Zachowaj ten plik przed aktualizacją bota.`,
      files: [backup],
    });
    await interaction.reply({ content: '✅ Wysłałem kopię zapisu na Twoją prywatną wiadomość na Discordzie.', ephemeral: true });
  } catch (error) {
    console.error('Nie udało się wysłać kopii zapisu w DM:', error);
    await interaction.reply({
      content: 'Nie mogę wysłać Ci DM. Włącz prywatne wiadomości od członków serwera i ponownie użyj `/save`.',
      ephemeral: true,
    });
  }
}

async function showBalance(interaction) {
  if (!requireGuild(interaction)) return;
  const user = getUser(interaction.guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0xffbe37)
    .setTitle('💰 Twoje saldo')
    .setDescription(`Masz **${user.balance} monet**.`)
    .setFooter({ text: 'Zarabiaj przez /work, /training i /job.' });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

const EVENT_SCHOOLS = [
  { id: 'raimon', name: 'Tydzień Raimon', accent: 0xf0a51b },
  { id: 'zeus', name: 'Tydzień Zeus', accent: 0x8fbf44 },
  { id: 'genesis', name: 'Tydzień Genesis', accent: 0x9467df },
];

function warsawDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function eventOfTheWeek(dateKey = warsawDateKey()) {
  const current = Date.parse(`${dateKey}T00:00:00Z`);
  const firstWeek = Date.parse('2026-10-04T00:00:00Z');
  const weekIndex = Math.floor((current - firstWeek) / (7 * 86_400_000));
  const eventIndex = ((weekIndex % EVENT_SCHOOLS.length) + EVENT_SCHOOLS.length) % EVENT_SCHOOLS.length;
  return EVENT_SCHOOLS[eventIndex];
}

async function claimDaily(interaction) {
  const dateKey = warsawDateKey();
  const event = eventOfTheWeek(dateKey);
  const result = claimDailyReward(interaction.guildId, interaction.user.id, dateKey, event.id);
  if (!result.ok) {
    await interaction.reply({ content: `Dzisiejszą nagrodę już odebrano. Twoja seria: **${result.streak}/3 dni**.`, ephemeral: true });
    return;
  }
  const unlock = result.unlockedBackground ? `\n🎨 Odblokowano tło profilu: **${event.name}**! Ustawisz je przez `/profil`.` : '';
  await interaction.reply({
    content: `📅 ${event.name} — dzień serii **${result.streak}/3**. Odbierasz **${result.reward} monet**. Masz **${result.balance} monet**.${unlock}`,
    ephemeral: true,
  });
}

async function showCalendar(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  const event = eventOfTheWeek();
  const today = warsawDateKey();
  const claimed = user.lastDaily === today;
  const dailyTrack = `1. dzień — **10 monet**\n2. dzień — **25 monet**\n3. i kolejne dni serii — **50 monet**`;
  const embed = new EmbedBuilder()
    .setColor(event.accent)
    .setTitle(`📅 Kalendarz wydarzeń — ${event.name}`)
    .setDescription(`Wydarzenie zmienia szkołę co tydzień. Odbierz nagrodę przez `/daily`.\n\n${dailyTrack}`)
    .addFields(
      { name: 'Twoja seria', value: `${user.dailyStreak}/3 dni`, inline: true },
      { name: 'Dzisiejsza nagroda', value: claimed ? 'Już odebrana' : 'Dostępna', inline: true },
    )
    .setFooter({ text: 'Po 3 dniach z rzędu odblokujesz tło profilu szkoły tygodnia.' });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showAchievements(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  const milestones = [
    { count: 100, reward: 200 },
    { count: 250, reward: 350 },
    { count: 500, reward: 700 },
  ];
  const lines = milestones.map(({ count, reward }) => {
    const complete = user.claimedWorkMilestones.includes(count);
    const progress = Math.min(user.workCount, count);
    return `${complete ? '✅' : '▫️'} **${count} prac** — ${progress}/${count} · nagroda: **${reward} monet**${complete ? ' (odebrano)' : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0xffbe37)
    .setTitle('🏅 Osiągnięcia pracy')
    .setDescription(`Liczba użyć /work: **${user.workCount}**\n\n${lines.join('\n')}`)
    .setFooter({ text: 'Nagrody i ozdoby profilu odblokowują się automatycznie po osiągnięciu celu.' });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

const PROFILE_OPTIONS = {
  frames: {
    standard: { name: 'Standardowa', color: 0x64748b },
    bronze: { name: 'Brązowa', color: 0xc07042 },
    silver: { name: 'Srebrna', color: 0xc3d8e8 },
    gold: { name: 'Złota', color: 0xffbe37 },
  },
  titles: {
    rookie: { name: 'Nowy zawodnik' },
    hardworker: { name: 'Pracowity' },
    hissatsu_hunter: { name: 'Łowca Hissatsu' },
    inazuma_legend: { name: 'Legenda Inazumy' },
  },
  backgrounds: {
    classic: { name: 'Klasyczne' },
    raimon: { name: 'Raimon' },
    zeus: { name: 'Zeus' },
    genesis: { name: 'Genesis' },
  },
};

function profileEmbed(user, username) {
  const frame = PROFILE_OPTIONS.frames[user.cosmetics.frame] ?? PROFILE_OPTIONS.frames.standard;
  return new EmbedBuilder()
    .setColor(frame.color)
    .setTitle(`👤 Profil — ${username}`)
    .setDescription(`**Tytuł:** ${PROFILE_OPTIONS.titles[user.cosmetics.title]?.name ?? 'Nowy zawodnik'}\n**Ramka:** ${frame.name}\n**Tło:** ${PROFILE_OPTIONS.backgrounds[user.cosmetics.background]?.name ?? 'Klasyczne'}\n**Monety:** ${user.balance}`)
    .setFooter({ text: 'Użyj poniższych list, aby wybrać odblokowany wygląd.' })
    .setImage('attachment://profil.png');
}

function profileRows(user) {
  const configKeys = { frames: 'frame', titles: 'title', backgrounds: 'background' };
  return Object.entries(configKeys).map(([listName, type]) => {
    const values = user.unlockedCosmetics[listName];
    const options = values.map((id) => ({
      label: PROFILE_OPTIONS[listName][id]?.name ?? id,
      value: id,
      default: user.cosmetics[type] === id,
    }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`profile:${type}`)
      .setPlaceholder(`Wybierz ${type === 'frame' ? 'ramkę' : type === 'title' ? 'tytuł' : 'tło'}`)
      .addOptions(options);
    return new ActionRowBuilder().addComponents(menu);
  });
}

async function showProfile(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  const banner = await renderProfileBanner(interaction.user.username, user, PROFILE_OPTIONS);
  await interaction.reply({
    embeds: [profileEmbed(user, interaction.user.username)],
    components: profileRows(user),
    files: [new AttachmentBuilder(Buffer.from(banner), { name: 'profil.png' })],
    ephemeral: true,
  });
}

function formationGroups(formation) {
  const [defenders, midfielders, forwards] = formation.split('-').map(Number);
  return [
    ...Array.from({ length: 1 }, () => 'Bramkarz'),
    ...Array.from({ length: defenders }, () => 'Obrońca'),
    ...Array.from({ length: midfielders }, () => 'Pomocnik'),
    ...Array.from({ length: forwards }, () => 'Napastnik'),
  ];
}

function arrangeTeam(playerNames, formation) {
  const unassigned = playerNames.map((name) => catalog.find((player) => player.name === name)).filter(Boolean);
  const slots = formationGroups(formation);
  return slots.map((position, index) => {
    let playerIndex = unassigned.findIndex((player) => player.position === position);
    if (playerIndex < 0) {
      playerIndex = unassigned.reduce((best, player, i, arr) => player.overall > arr[best].overall ? i : best, 0);
    }
    const [player] = unassigned.splice(playerIndex, 1);
    return { slot: index + 1, position, player };
  });
}

function teamEmblemRow(user) {
  const owned = emblems.filter((emblem) => user.emblems.includes(emblem.id));
  if (!owned.length || !user.team) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId('team-equip-emblem')
    .setPlaceholder('Załóż herb na skład')
    .addOptions(owned.map((emblem) => ({
      label: emblem.name,
      value: emblem.id,
      default: user.team.emblem === emblem.id,
    })));
  return [new ActionRowBuilder().addComponents(menu)];
}

async function teamMessage(user, username) {
  const lineup = arrangeTeam(user.team.players, user.team.formation);
  const avgOverall = Math.round(lineup.reduce((sum, entry) => sum + entry.player.overall, 0) / lineup.length);
  const emblem = emblems.find((item) => item.id === user.team.emblem);
  const embed = new EmbedBuilder()
    .setColor(emblem?.color ?? 0x168cff)
    .setTitle(`⚽ Skład — ${username}`)
    .setDescription(`Formacja **${user.team.formation}** · średni OVERALL **${avgOverall}**${emblem ? `\nHerb: **${emblem.name}**` : ''}\n\nUstawienie zawodników zmienisz przez `/team`. Herb możesz zmienić przez `/herb`.`)
    .setImage('attachment://squad-pitch.png');
  const image = await renderSquadPitch(lineup, user.team.formation, emblem);
  return {
    embeds: [embed],
    components: teamEmblemRow(user),
    files: [new AttachmentBuilder(Buffer.from(image), { name: 'squad-pitch.png' })],
    attachments: [],
  };
}

const teamBuildSessions = new Map();
const TEAM_FORMATIONS = new Set(['4-4-2', '4-3-3', '3-5-2']);
const TEAM_PAGE_SIZE = 25;

function teamBuildKey(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function teamBuildPositionOptions() {
  const positions = [...new Set(catalog.map((player) => player.position).filter(Boolean))];
  return ['Wszystkie', ...positions];
}

function teamBuildElementOptions() {
  const elements = [...new Set(catalog.map((player) => player.element).filter(Boolean))];
  return ['Wszystkie', ...elements];
}

function teamBuildRows(state) {
  const selected = new Set(state.selected);
  const allAvailable = catalog.filter((player) => state.ownedNames.includes(player.name) && !selected.has(player.name));
  let filtered = allAvailable.filter((player) =>
    (state.positionFilter === 'Wszystkie' || player.position === state.positionFilter) &&
    (state.elementFilter === 'Wszystkie' || player.element === state.elementFilter));
  filtered.sort((a, b) => state.sort === 'asc'
    ? a.overall - b.overall || a.name.localeCompare(b.name, 'pl')
    : b.overall - a.overall || a.name.localeCompare(b.name, 'pl'));
  const maxPage = Math.max(0, Math.ceil(filtered.length / TEAM_PAGE_SIZE) - 1);
  state.page = Math.min(state.page, maxPage);
  const pagePlayers = filtered.slice(state.page * TEAM_PAGE_SIZE, (state.page + 1) * TEAM_PAGE_SIZE);
  const currentSlot = state.selected.length;
  const targetPosition = state.positions[currentSlot];
  const rows = [];

  if (currentSlot < 11) {
    const playerMenu = new StringSelectMenuBuilder()
      .setCustomId('team-build-player')
      .setPlaceholder(pagePlayers.length ? `Wybierz ${targetPosition.toLocaleLowerCase('pl')} — strona ${state.page + 1}/${maxPage + 1}` : 'Brak wyników — zmień filtry')
      .addOptions(pagePlayers.length
        ? pagePlayers.map((player) => ({
          label: player.name,
          value: player.name,
          description: `${player.position} · ${player.element} · OVERALL ${player.overall}`,
        }))
        : [{ label: 'Brak wyników — zmień filtry', value: '__no_results__', description: 'Zmień pozycję lub żywioł poniżej.' }]);
    rows.push(new ActionRowBuilder().addComponents(playerMenu));
  }

  const positionMenu = new StringSelectMenuBuilder()
    .setCustomId('team-build-position')
    .setPlaceholder('Pozycja')
    .addOptions(teamBuildPositionOptions().map((value) => ({
      label: value,
      value,
      default: value === state.positionFilter,
    })));
  rows.push(new ActionRowBuilder().addComponents(positionMenu));

  const elementMenu = new StringSelectMenuBuilder()
    .setCustomId('team-build-element')
    .setPlaceholder('Żywioł')
    .addOptions(teamBuildElementOptions().map((value) => ({
      label: value,
      value,
      default: value === state.elementFilter,
    })));
  rows.push(new ActionRowBuilder().addComponents(elementMenu));

  const sortMenu = new StringSelectMenuBuilder()
    .setCustomId('team-build-sort')
    .setPlaceholder('Sortowanie po OVERALL')
    .addOptions([
      { label: 'Od najmniejszego OVERALL', value: 'asc', default: state.sort === 'asc' },
      { label: 'Od największego OVERALL', value: 'desc', default: state.sort === 'desc' },
    ]);
  rows.push(new ActionRowBuilder().addComponents(sortMenu));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team-build:back').setLabel('◀ Cofnij').setStyle(ButtonStyle.Secondary).setDisabled(state.selected.length === 0),
    new ButtonBuilder().setCustomId('team-build:page-prev').setLabel('◀ Karty').setStyle(ButtonStyle.Secondary).setDisabled(state.page === 0 || currentSlot >= 11),
    new ButtonBuilder().setCustomId('team-build:page-next').setLabel('Karty ▶').setStyle(ButtonStyle.Secondary).setDisabled(state.page >= maxPage || currentSlot >= 11),
    new ButtonBuilder().setCustomId('team-build:cancel').setLabel('Anuluj').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('team-build:save').setLabel('Zapisz skład').setStyle(ButtonStyle.Success).setDisabled(state.selected.length !== 11),
  );
  rows.push(buttons);
  return rows;
}

async function renderTeamBuilder(interaction, state) {
  const currentSlot = state.selected.length;
  const positions = state.positions;
  const targetPosition = currentSlot < 11 ? positions[currentSlot] : 'Gotowe';
  const preview = await renderSquadBuilderPreview(state.formation);
  const embed = new EmbedBuilder()
    .setColor(0x168cff)
    .setTitle(`🧩 Budowanie składu — ${state.formation}`)
    .setDescription(
      currentSlot < 11
        ? `**Pozycja ${currentSlot + 1}/11: ${targetPosition}**\nWybierz jednego zawodnika w menu. Pozycję, żywioł i kolejność overall możesz filtrować poniżej.\n\nUstawiona pozycja slotu: **${targetPosition}**.`
        : '✅ Wybrano 11 zawodników. Zapisz skład przyciskiem poniżej.',
    )
    .setImage('attachment://squad-builder.png')
    .setFooter({ text: `Pozycja: ${state.positionFilter} · Żywioł: ${state.elementFilter} · OVERALL: ${state.sort === 'asc' ? 'rosnąco' : 'malejąco'}` });
  const payload = {
    content: `Postęp składu: **${state.selected.length}/11** · Pozostało kart do wyboru: **${state.ownedNames.length - state.selected.length}**.`,
    embeds: [embed],
    files: [new AttachmentBuilder(Buffer.from(preview), { name: 'squad-builder.png' })],
    components: teamBuildRows(state),
    attachments: [],
  };
  if (interaction.isButton() || interaction.isStringSelectMenu()) await interaction.update(payload);
  else await interaction.reply({ ...payload, ephemeral: true });
}

async function showTeam(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  const formation = interaction.options.getString('formacja');
  if (!formation) {
    if (!user.team) {
      await interaction.reply({ content: 'Nie masz jeszcze ustawionego składu. Użyj `/team formacja:4-4-2` i wybierz 11 kart.', ephemeral: true });
      return;
    }
    await interaction.reply({ ...await teamMessage(user, interaction.user.username), ephemeral: true });
    return;
  }
  if (!TEAM_FORMATIONS.has(formation)) {
    await interaction.reply({ content: 'Wybierz jedną z formacji: 4-4-2, 4-3-3 albo 3-5-2.', ephemeral: true });
    return;
  }
  const ownedNames = [...new Set(user.cards.map((card) => card.name))]
    .filter((name) => catalog.some((player) => player.name === name));
  if (ownedNames.length < 11) {
    await interaction.reply({ content: `Do ustawienia składu potrzebujesz 11 różnych zawodników. Masz **${ownedNames.length}**.`, ephemeral: true });
    return;
  }
  const positions = formationGroups(formation);
  const session = {
    formation,
    positions,
    ownedNames,
    selected: [],
    positionFilter: positions[0],
    elementFilter: 'Wszystkie',
    sort: 'desc',
    page: 0,
  };
  teamBuildSessions.set(teamBuildKey(interaction), session);
  await renderTeamBuilder(interaction, session);
}

async function showSquad(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  if (!user.team) {
    await interaction.reply({
      content: 'Nie masz jeszcze zapisanego składu. Użyj `/team`, wybierz formację i 11 zawodników.',
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({ ...await teamMessage(user, interaction.user.username), ephemeral: true });
}

async function chooseTeamEmblem(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  if (!user.team) {
    await interaction.reply({ content: 'Najpierw ustaw swój skład przez `/team`.', ephemeral: true });
    return;
  }
  const owned = emblems.filter((emblem) => user.emblems.includes(emblem.id));
  if (!owned.length) {
    await interaction.reply({ content: 'Nie masz jeszcze herbu. Zdobędziesz go z Hissatsu Pack w `/sklep`.', ephemeral: true });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId('team-equip-emblem')
    .setPlaceholder('Wybierz herb dla składu')
    .addOptions(owned.map((emblem) => ({ label: emblem.name, value: emblem.id, default: user.team.emblem === emblem.id })));
  await interaction.reply({ content: 'Wybierz herb drużyny:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
}

async function buyHissatsuPack(interaction) {
  const result = buyEmblemPack(interaction.guildId, interaction.user.id, EMBLEM_PACK_PRICE, emblems);
  if (!result.ok) {
    const content = result.reason === 'all-owned'
      ? `Masz już wszystkie herby: ${emblems.map((emblem) => emblem.name).join(', ')}.`
      : `Masz **${result.balance} monet**, a Hissatsu Pack kosztuje **${EMBLEM_PACK_PRICE}**.`;
    await interaction.reply({ content, ephemeral: true });
    return;
  }
  const imageName = `herb-${result.emblem.id}.png`;
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(result.emblem.color.replace('#', ''), 16))
    .setTitle(`✨ Zdobywasz herb ${result.emblem.name}!`)
    .setDescription(`Pozostało **${result.balance} monet**. Załóż herb na skład komendą herb.`)
    .setImage(`attachment://${imageName}`);
  await interaction.reply({ embeds: [embed], files: [new AttachmentBuilder(path.join(ASSETS, result.emblem.image), { name: imageName })], ephemeral: true });
}

async function handleGameSelect(interaction) {
  if (interaction.customId.startsWith('team-build-')) {
    const state = teamBuildSessions.get(teamBuildKey(interaction));
    if (!state) {
      await interaction.update({ content: 'Sesja budowania składu wygasła. Uruchom ponownie `/team`.', embeds: [], components: [], attachments: [] });
      return;
    }
    if (interaction.customId === 'team-build-position') {
      state.positionFilter = interaction.values[0];
      state.page = 0;
      await renderTeamBuilder(interaction, state);
      return;
    }
    if (interaction.customId === 'team-build-element') {
      state.elementFilter = interaction.values[0];
      state.page = 0;
      await renderTeamBuilder(interaction, state);
      return;
    }
    if (interaction.customId === 'team-build-sort') {
      state.sort = interaction.values[0];
      state.page = 0;
      await renderTeamBuilder(interaction, state);
      return;
    }
    if (interaction.customId === 'team-build-player') {
      const name = interaction.values[0];
      if (name === '__no_results__') {
        await renderTeamBuilder(interaction, state);
        return;
      }
      if (state.selected.includes(name) || !state.ownedNames.includes(name)) {
        await interaction.update({ content: 'Tej karty nie można dodać do składu. Wybierz inną.', embeds: [], components: [] });
        return;
      }
      state.selected.push(name);
      state.page = 0;
      state.positionFilter = state.positions[state.selected.length] ?? 'Wszystkie';
      state.elementFilter = 'Wszystkie';
      await renderTeamBuilder(interaction, state);
      return;
    }
  }
  if (interaction.customId.startsWith('team-select:')) {
    const formation = interaction.customId.split(':')[1];
    const result = saveTeam(interaction.guildId, interaction.user.id, formation, interaction.values);
    if (!result.ok) {
      await interaction.update({ content: 'Nie udało się zapisać składu. Sprawdź, czy wybrano 11 posiadanych zawodników.', components: [], embeds: [] });
      return;
    }
    const user = getUser(interaction.guildId, interaction.user.id);
    await interaction.update({ content: '✅ Skład zapisany. Możesz wybrać herb w menu poniżej.', ...await teamMessage(user, interaction.user.username) });
    return;
  }
  if (interaction.customId === 'team-equip-emblem') {
    const result = setTeamEmblem(interaction.guildId, interaction.user.id, interaction.values[0]);
    if (!result.ok) {
      await interaction.update({ content: 'Nie udało się założyć herbu. Najpierw ustaw skład i zdobądź herb.', components: [] });
      return;
    }
    await interaction.update({ content: '✅ Herb założony na Twój skład.', ...await teamMessage(getUser(interaction.guildId, interaction.user.id), interaction.user.username) });
    return;
  }
  if (interaction.customId.startsWith('profile:')) {
    const type = interaction.customId.split(':')[1];
    setCosmetic(interaction.guildId, interaction.user.id, type, interaction.values[0]);
    const user = getUser(interaction.guildId, interaction.user.id);
    const banner = await renderProfileBanner(interaction.user.username, user, PROFILE_OPTIONS);
    await interaction.update({
      embeds: [profileEmbed(user, interaction.user.username)],
      components: profileRows(user),
      files: [new AttachmentBuilder(Buffer.from(banner), { name: 'profil.png' })],
      attachments: [],
    });
  }
}

async function playRouletteRound(interaction) {
  if (!requireGuild(interaction)) return;
  const stake = interaction.options.getInteger('stawka', true);
  const chosenColor = interaction.options.getString('kolor', true);
  const result = playRoulette(interaction.guildId, interaction.user.id, stake, chosenColor);

  if (!result.ok) {
    const message = result.reason === 'insufficient-funds'
      ? `Masz **${result.balance} monet**, więc nie możesz postawić **${stake}**.`
      : 'Stawka musi wynosić od 1 do 100 monet.';
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const colorName = result.color === 'red' ? 'czerwone' : result.color === 'black' ? 'czarne' : 'zielone (zero)';
  const embed = new EmbedBuilder()
    .setColor(result.color === 'red' ? 0xe74c3c : result.color === 'black' ? 0x252525 : 0x2ecc71)
    .setTitle('🎡 Ruletka')
    .setDescription(
      `Wypadło **${result.number} — ${colorName}**.\n` +
      (result.won
        ? `🎉 Trafiłeś! Wypłata: **${result.payout} monet** (2× stawka).`
        : `😔 Nie tym razem. Przegrywasz **${stake} monet**.`),
    )
    .setFooter({ text: `Twoje saldo: ${result.balance} monet` });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot działa jako ${readyClient.user.tag} | TEAM-BUILDER-FILTERS-v7 | Hissatsu Pack 2026-10-07 | zawodnicy: ${catalog.length} | herby: ${emblems.length}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.respond([]);
        return;
      }
      if (interaction.commandName === 'stats') {
        const query = interaction.options.getFocused().toLocaleLowerCase('pl');
        const choices = catalog
          .filter((player) => player.name.toLocaleLowerCase('pl').includes(query))
          .slice(0, 25)
          .map((player) => ({ name: player.name, value: player.name }));
        await interaction.respond(choices);
      }
      return;
    }
    if (interaction.isButton()) {
      if (!requireGuild(interaction) || !(await requireAdmin(interaction)) || !(await requireGameAccess(interaction))) return;
      if (interaction.customId.startsWith('team-build:')) {
        const state = teamBuildSessions.get(teamBuildKey(interaction));
        if (!state) {
          await interaction.update({ content: 'Sesja budowania składu wygasła. Uruchom ponownie `/team`.', embeds: [], components: [], attachments: [] });
          return;
        }
        const action = interaction.customId.split(':')[1];
        if (action === 'cancel') {
          teamBuildSessions.delete(teamBuildKey(interaction));
          await interaction.update({ content: 'Budowanie składu anulowane.', embeds: [], components: [], attachments: [] });
        } else if (action === 'back') {
          if (state.selected.length) state.selected.pop();
          const nextPosition = state.positions[state.selected.length];
          state.positionFilter = nextPosition ?? 'Wszystkie';
          state.page = 0;
          await renderTeamBuilder(interaction, state);
        } else if (action === 'page-prev' || action === 'page-next') {
          state.page = Math.max(0, state.page + (action === 'page-next' ? 1 : -1));
          await renderTeamBuilder(interaction, state);
        } else if (action === 'save') {
          const result = saveTeam(interaction.guildId, interaction.user.id, state.formation, state.selected);
          if (!result.ok) {
            await interaction.update({ content: 'Nie udało się zapisać składu. Sprawdź, czy wybrano 11 różnych posiadanych kart.', embeds: [], components: [] });
            return;
          }
          teamBuildSessions.delete(teamBuildKey(interaction));
          await interaction.update({ content: '✅ Skład zapisany. Możesz wybrać herb w menu poniżej.', ...await teamMessage(getUser(interaction.guildId, interaction.user.id), interaction.user.username) });
        }
      } else if (interaction.customId === 'shop-prev' || interaction.customId === 'shop-next') {
        await showShop(interaction, interaction.customId === 'shop-next' ? 1 : 0, true);
      } else if (interaction.customId.startsWith('collection-page:')) {
        const page = Number(interaction.customId.split(':')[1]);
        await showCollection(interaction, page, true);
      } else if (interaction.customId === 'collection-prev' || interaction.customId === 'collection-next') {
        await showCollection(interaction, interaction.customId === 'collection-next' ? 1 : 0, true);
      } else if (interaction.customId === 'buy-player-pack') {
        await openPack(interaction);
      } else if (interaction.customId === 'buy-hissatsu-pack') {
        await buyHissatsuPack(interaction);
      }
      return;
    }
    if (interaction.isStringSelectMenu()) {
      if (!requireGuild(interaction) || !(await requireAdmin(interaction)) || !(await requireGameAccess(interaction))) return;
      await handleGameSelect(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (!requireGuild(interaction) || !(await requireAdmin(interaction)) || !(await requireGameAccess(interaction))) return;
    if (interaction.commandName === 'save' && Date.now() < BETA_END_AT && !(await requireAdmin(interaction))) return;

    switch (interaction.commandName) {
      case 'sklep':
        await showShop(interaction);
        break;
      case 'work':
        await earn(interaction, 'wykonuje pracę');
        break;
      case 'training':
        await earn(interaction, 'kończy trening');
        break;
      case 'job':
        await earn(interaction, 'wraca z pracy');
        break;
      case 'free':
        await claimFree(interaction);
        break;
      case 'saldo':
        await showBalance(interaction);
        break;
      case 'save':
        await sendSave(interaction);
        break;
      case 'ruletke':
        await playRouletteRound(interaction);
        break;
      case 'stats':
        await showStats(interaction);
        break;
      case 'kolekcja':
        await showCollection(interaction);
        break;
      case 'daily':
        await claimDaily(interaction);
        break;
      case 'calendar':
        await showCalendar(interaction);
        break;
      case 'osiągnięcia':
        await showAchievements(interaction);
        break;
      case 'profil':
        await showProfile(interaction);
        break;
      case 'team':
        await showTeam(interaction);
        break;
      case 'squad':
        await showSquad(interaction);
        break;
      case 'herb':
        await chooseTeamEmblem(interaction);
        break;
      default:
        await interaction.reply({ content: 'Nie znam tej komendy.', ephemeral: true });
    }
  } catch (error) {
    console.error('Błąd obsługi interakcji:', error);
    const detail = `${error?.name ?? 'Błąd'}: ${error?.message ?? 'Nieznana przyczyna'}`.slice(0, 700);
    const response = { content: `Operacja się nie udała. Szczegóły błędu: \`${detail}\``, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

client.login(TOKEN);
