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
  HISSATSU_CHALLENGE_TIMEOUT_MS,
  JOB_COOLDOWN_MS,
  JOB_LOSS_MAX,
  JOB_LOSS_MIN,
  JOB_MAX_REWARD,
  JOB_MIN_REWARD,
  EMBLEM_PACK_PRICE,
  TRAINING_COOLDOWN_MS,
  TRAINING_MAX_REWARD,
  TRAINING_MIN_REWARD,
  WORK_COOLDOWN_MS,
  WORK_MAX_REWARD,
  WORK_MIN_REWARD,
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
  importSaveBackup,
  getUser,
  playRoulette,
  saveTeam,
  setCosmetic,
  setProfileImage,
  setTeamEmblem,
  recordHissatsuChallenge,
  startHissatsuChallenge,
  verifyEarnAction,
  recordMatchResult,
} from './economy.js';
import { renderCollection, renderMatchPitch, renderPlayerCard, renderPlayerComparison, renderProfileBanner, renderSquadBuilderPreview, renderSquadPitch } from './gallery.js';
import { createMatchMode } from './match.js';

if (!TOKEN) {
  console.error('Brakuje DISCORD_TOKEN. Skopiuj .env.example do .env i uzupełnij token.');
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(path.join(ASSETS, 'katalog.json'), 'utf8'));
const emblems = JSON.parse(fs.readFileSync(path.join(ASSETS, 'emblems.json'), 'utf8'));

const statsFile = path.join(ASSETS, 'statystyki-zawodnikow.json');
const playerStats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : [];
const statsByName = new Map(playerStats.map((entry) => [entry.name, entry]));
for (const player of catalog) {
  const researched = statsByName.get(player.name);
  if (researched) {
    player.stats = researched.stats;
    player.stat_source = researched.source ?? null;
    player.stat_seasons = researched.reference_seasons ?? researched.seasons ?? null;
  }
}

const ELEMENT_NAMES = { Fire: 'Ogień', Wind: 'Wiatr', Forest: 'Las', Mountain: 'Góra' };
function normalizeHissatsuType(type) {
  if (type === 'Odbiór' || type === 'Odbierająca') return 'Odbiór';
  if (type === 'Strzał' || type === 'Drybling' || type === 'Obrona bramkarska') return type;
  return null;
}
const HISSATSU_QUESTIONS = catalog.flatMap((player) => (player.hissatsu ?? []).flatMap((hissatsu) => {
  if (!hissatsu?.name) return [];
  const question = { player: player.name, hissatsu: hissatsu.name };
  const options = [];
  const element = ELEMENT_NAMES[hissatsu.element];
  const type = normalizeHissatsuType(hissatsu.type);
  if (element) options.push({ ...question, kind: 'element', answer: element });
  if (type) options.push({ ...question, kind: 'type', answer: type });
  return options;
}));
const HISSATSU_ANSWERS = {
  element: Object.values(ELEMENT_NAMES),
  type: ['Strzał', 'Drybling', 'Odbiór', 'Obrona bramkarska'],
};
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

const matchMode = createMatchMode({
  catalog,
  emblems,
  getUser,
  getSavedTeam,
  recordMatchResult,
  renderMatchPitch,
  discord: { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder },
});

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

async function showPackOdds(interaction) {
  const ranges = [
    { label: 'OVERALL 34–49', min: 34, max: 49 },
    { label: 'OVERALL 50–64', min: 50, max: 64 },
    { label: 'OVERALL 65–74', min: 65, max: 74 },
    { label: 'OVERALL 75–84', min: 75, max: 84 },
    { label: 'OVERALL 85–89', min: 85, max: 89 },
    { label: 'OVERALL 90–99', min: 90, max: 99 },
  ];
  const totalWeight = catalog.reduce((sum, player) => sum + player.chance_percent, 0);
  const toPercent = (weight) => (weight / totalWeight) * 100;
  const fields = ranges.map(({ label, min, max }) => {
    const players = catalog.filter((player) => player.overall >= min && player.overall <= max);
    const totalChance = players.reduce((sum, player) => sum + toPercent(player.chance_percent), 0);
    const lines = players.map((player) =>
      `• ${player.name} — ${toPercent(player.chance_percent).toLocaleString('pl-PL', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`);
    return {
      name: `${label} · razem ${totalChance.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
      value: lines.join('\n') || 'Brak zawodników',
    };
  });
  const embed = new EmbedBuilder()
    .setColor(0x37b77b)
    .setTitle('📊 Szanse — paczka S2')
    .setDescription('Szansa na wylosowanie **jednego zawodnika**. Paczka zawiera 5 niezależnych losowań.')
    .addFields(...fields)
    .setFooter({ text: 'Wszystkie szanse razem: 100%.' });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showShop(interaction, page = 0, edit = false) {
  const emblemPage = page === 1;
  const imageName = emblemPage ? 'hissatsu_pack.png' : 'paczka_s2_wide.jpg';
  const avatarName = 'hissatsu_pack_avatar.png';
  const emblemNames = emblems.map((entry) => entry.name).join(', ');
  const herbCommand = '/herb';
  const embed = emblemPage
    ? new EmbedBuilder()
      .setColor(0x9868e8)
      .setTitle('✨ Hissatsu Pack — herby szkół')
      .setDescription(`Paczka daje **1 herb** spośród ${emblemNames}; możliwa jest też powtórka (+10 monet).\nCena: **${EMBLEM_PACK_PRICE} monet**. Herbem możesz oznaczyć swój skład przez \`${herbCommand}\`.`)
      .setImage(`attachment://${imageName}`)
      .setFooter({ text: 'Przełącz paczki strzałkami poniżej.' })
    : new EmbedBuilder()
      .setColor(0x168cff)
      .setTitle('⚡ Sklep Inazuma Eleven — paczka S2')
      .setDescription(`Jedna paczka zawiera **${PACK_SIZE} zawodników**.\nCena: **${PACK_PRICE} monet**\n\n/work: 5–10 monet co 30 s · /training: 10–25 co 2 min · /job: 25–30 co 5 min (50% ryzyka straty 5–10).\n\nDuplikaty zamieniają się na monety: brąz 10, srebro 20, złoto 30.`)
      .setImage(`attachment://${imageName}`)
      .setFooter({ text: 'Zarabiaj przez /work, /training lub /job albo odbierz jednorazowe /free.' });
  if (emblemPage) {
    embed.setThumbnail(`attachment://${avatarName}`);
  } else {
    embed.setFooter({ text: 'Kliknij zielony przycisk 📊 Szanse, aby zobaczyć szansę każdego zawodnika.' });
  }
  const previous = new ButtonBuilder().setCustomId('shop-prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(!emblemPage);
  const buy = new ButtonBuilder()
    .setCustomId(emblemPage ? 'buy-hissatsu-pack' : 'buy-player-pack')
    .setLabel(emblemPage ? `Kup Hissatsu Pack — ${EMBLEM_PACK_PRICE}` : `Kup paczkę — ${PACK_PRICE}`)
    .setEmoji('🎁')
    .setStyle(ButtonStyle.Primary);
  const next = new ButtonBuilder().setCustomId('shop-next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(emblemPage);
  const odds = new ButtonBuilder()
    .setCustomId('shop-odds')
    .setLabel('Szanse')
    .setEmoji('📊')
    .setStyle(ButtonStyle.Success)
    .setDisabled(emblemPage);
  const row = new ActionRowBuilder().addComponents(previous, odds, buy, next);
  const image = new AttachmentBuilder(path.join(ASSETS, imageName));
  const files = [image];
  if (emblemPage) files.push(new AttachmentBuilder(path.join(ASSETS, avatarName)));
  const payload = { embeds: [embed], components: [row], files };
  if (edit) payload.attachments = [];
  if (edit) await interaction.update(payload);
  else await interaction.reply(payload);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function earn(interaction, activity) {
  if (!requireGuild(interaction)) return;
  const settings = {
    work: { min: WORK_MIN_REWARD, max: WORK_MAX_REWARD, cooldown: WORK_COOLDOWN_MS, text: 'wykonujesz pracę' },
    training: { min: TRAINING_MIN_REWARD, max: TRAINING_MAX_REWARD, cooldown: TRAINING_COOLDOWN_MS, text: 'kończysz trening', tasks: ['ćwiczysz celność strzałów', 'trenujesz slalom z piłką', 'poprawiasz refleks bramkarski', 'powtarzasz technikę Hissatsu', 'pracujesz nad szybkością'] },
    job: { min: JOB_MIN_REWARD, max: JOB_MAX_REWARD, cooldown: JOB_COOLDOWN_MS, text: 'wracasz z pracy', tasks: ['zbierasz piłki po treningu', 'przygotowujesz boisko przed zajęciami', 'pomagasz w klubowym sklepiku', 'roznosisz plakaty o naborze', 'porządkujesz sprzęt sportowy'] },
  }[activity];
  if (!settings) throw new Error('Nieznana komenda zarobkowa.');

  const jobFailed = activity === 'job' && Math.random() < 0.5;
  const amount = jobFailed
    ? randomInt(JOB_LOSS_MIN, JOB_LOSS_MAX)
    : randomInt(settings.min, settings.max);
  const signedReward = jobFailed ? -amount : amount;
  const result = claimReward(interaction.guildId, interaction.user.id, signedReward, settings.cooldown, activity);
  if (!result.ok) {
    if (result.reason === 'verification-pending') {
      await interaction.reply({ content: '🤖 Najpierw potwierdź zielonym przyciskiem w poprzedniej wiadomości.', ephemeral: true });
      return;
    }
    const timestamp = Math.ceil(result.nextEarnAt / 1000);
    const message = result.reason === 'verification-failed'
      ? '⛔ Nie potwierdziłeś weryfikacji. Komendy zarobkowe są zablokowane do <t:' + timestamp + ':R>.'
      : '⏱️ Tej komendy możesz użyć ponownie <t:' + timestamp + ':R>.';
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const achievementText = result.achievements.map((achievement) => '🏅 Osiągnięcie ' + achievement.count + ' użyć /work: **+' + achievement.reward + ' monet** i nowe ozdoby profilu!').join('\n');
  const trophyText = trophyNotice(result.trophies);
  const progress = activity === 'work' ? ' Postęp /work: **' + result.workCount + '**.' : '';
  const taskText = settings.tasks ? ' Zadanie: **' + settings.tasks[Math.floor(Math.random() * settings.tasks.length)] + '**.' : '';
  const rewardText = result.reward < 0
    ? 'Nieudana praca — tracisz **' + Math.abs(result.reward) + ' monet**.'
    : 'Dostajesz **' + result.reward + ' monet**.';
  const nextText = activity === 'work' ? '30 sekund' : activity === 'training' ? '2 minuty' : '5 minut';
  const verificationText = result.verificationRequired
    ? '\n\n🤖 Potwierdź zielonym przyciskiem w ciągu minuty. Bez potwierdzenia komendy zarobkowe zostaną zablokowane na 3 minuty.'
    : '';
  const components = result.verificationRequired
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId('earn-verify:' + interaction.user.id + ':' + result.verificationUntil)
      .setLabel('Potwierdzam')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success))]
    : [];
  await interaction.reply({
    content: '💰 ' + interaction.user + ' ' + settings.text + '.' + taskText + ' ' + rewardText + progress + '\n' + achievementText + trophyText + '\nMasz teraz **' + result.balance + ' monet**. Następna ' + activity + ' za ' + nextText + '.' + verificationText,
    components,
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
  await interaction.reply({
    content: `🎁 ${interaction.user} otwiera paczkę S2!${result.duplicateCoins ? ` Duplikaty dały **${result.duplicateCoins} monet**.` : ''}${trophyNotice(result.trophies)} Pozostało **${result.balance} monet**.`,
    files: [animation],
  });

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const delay = index === 0 ? OPENING_ANIMATION_MS : CARD_REVEAL_DELAY_MS;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const imageName = `zawodnik-${index + 1}.png`;
    const renderedCard = await renderPlayerCard(card);
    const pull = result.pulls[index];
    const duplicate = pull?.isDuplicate ? pull : null;
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

async function importDatabase(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const attachment = interaction.options.getAttachment('plik', true);
  const maxBytes = 10 * 1024 * 1024;
  if (attachment.size > maxBytes) {
    await interaction.editReply({ content: 'Plik kopii jest za duży. Maksymalny rozmiar to 10 MB.' });
    return;
  }

  let backup;
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Pobieranie pliku nie powiodło się.');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Plik przekracza 10 MB.');
    backup = JSON.parse(text);
  } catch {
    await interaction.editReply({
      content: 'Nie mogę odczytać tego pliku. Ta komenda przyjmuje kopię JSON z /save lub plik users.json tego bota. Baza SQLite, np. coinflip.db, ma inny format i nie jest zgodna.',
    });
    return;
  }

  const overwrite = interaction.options.getBoolean('nadpisz') ?? false;
  const result = importSaveBackup(interaction.guildId, backup, overwrite);
  if (!result.ok) {
    const message = result.reason === 'no-guild-data'
      ? 'W kopii nie ma zapisów z tego serwera Discord.'
      : 'Plik nie ma poprawnego formatu kopii bazy Inazumy. Użyj pliku JSON pobranego przez /save.';
    await interaction.editReply({ content: message });
    return;
  }

  const summary = 'dodano: **' + result.imported + '** · zastąpiono: **' + result.replaced + '** · pominięto: **' + result.skipped + '** (już istnieją)';
  const safety = result.safetyBackup
    ? '\\nUtworzyłem też kopię bezpieczeństwa bieżącej bazy przed zastąpieniem danych.'
    : '';
  await interaction.editReply({
    content: '✅ Import kopii zakończony. ' + summary + '.' + safety,
  });
}
function trainingRank(points) {
  if (points >= 150) return 'Mistrz Hissatsu';
  if (points >= 50) return 'Zawodnik';
  return 'Początkujący';
}

async function startHissatsuChallengeCommand(interaction) {
  if (!requireGuild(interaction)) return;
  if (!HISSATSU_QUESTIONS.length) {
    await interaction.reply({ content: 'W katalogu nie ma jeszcze technik Hissatsu do quizu.', ephemeral: true });
    return;
  }
  const started = startHissatsuChallenge(interaction.guildId, interaction.user.id);
  if (!started.ok) {
    await interaction.reply({ content: '⏱️ Następne wyzwanie możesz rozpocząć <t:' + Math.ceil(started.nextAt / 1000) + ':R>.', ephemeral: true });
    return;
  }
  const prompt = HISSATSU_QUESTIONS[Math.floor(Math.random() * HISSATSU_QUESTIONS.length)];
  const allAnswers = HISSATSU_ANSWERS[prompt.kind];
  const choices = [prompt.answer, ...allAnswers.filter((answer) => answer !== prompt.answer)]
    .sort(() => Math.random() - 0.5);
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const buttons = new ActionRowBuilder().addComponents(choices.map((answer, index) =>
    new ButtonBuilder()
      .setCustomId('hissatsu:' + token + ':' + index)
      .setLabel(answer)
      .setStyle(ButtonStyle.Secondary)));
  const promptText = prompt.kind === 'element'
    ? 'Jaki żywioł ma technika **' + prompt.hissatsu + '** zawodnika **' + prompt.player + '**?'
    : 'Jaki rodzaj ma technika **' + prompt.hissatsu + '** zawodnika **' + prompt.player + '**?';
  const rank = trainingRank(started.points);
  const challenge = {
    userId: interaction.user.id,
    choices,
    answer: prompt.answer,
    timer: null,
  };
  hissatsuChallengeSessions.set(token, challenge);
  await interaction.reply({
    content: '⚡ **Trening Hissatsu**\n' + promptText + '\n\nMasz **15 sekund**. Za dobrą odpowiedź: punkty treningu i monety. Seria zwiększa nagrodę.\nRanga: **' + rank + '** · Punkty treningu: **' + started.points + '** · Seria: **' + started.streak + '**',
    components: [buttons],
    ephemeral: true,
  });
  challenge.timer = setTimeout(async () => {
    if (!hissatsuChallengeSessions.has(token)) return;
    hissatsuChallengeSessions.delete(token);
    recordHissatsuChallenge(interaction.guildId, interaction.user.id, false);
    await interaction.editReply({ content: '⌛ Czas minął! Seria została wyzerowana. Następnym razem zdążysz.', components: [] }).catch(() => {});
  }, HISSATSU_CHALLENGE_TIMEOUT_MS);
  challenge.timer.unref?.();
}

async function answerHissatsuChallenge(interaction) {
  const [, token, answerIndexText] = interaction.customId.split(':');
  const challenge = hissatsuChallengeSessions.get(token);
  if (!challenge) {
    await interaction.update({ content: '⌛ To wyzwanie już wygasło. Uruchom ponownie /wyzwanie.', components: [] });
    return;
  }
  if (challenge.userId !== interaction.user.id) {
    await interaction.reply({ content: 'To wyzwanie należy do innego gracza.', ephemeral: true });
    return;
  }
  clearTimeout(challenge.timer);
  hissatsuChallengeSessions.delete(token);
  const selected = challenge.choices[Number(answerIndexText)];
  const correct = selected === challenge.answer;
  const result = recordHissatsuChallenge(interaction.guildId, interaction.user.id, correct);
  if (!correct) {
    await interaction.update({ content: '❌ Nie tym razem. Poprawna odpowiedź: **' + challenge.answer + '**. Seria została wyzerowana. Punkty treningu: **' + result.points + '** · Ranga: **' + trainingRank(result.points) + '**.', components: [] });
    return;
  }
  const previousPoints = result.points - result.pointsEarned;
  const levelUp = trainingRank(previousPoints) !== trainingRank(result.points);
  const streakMessage = result.streak > 1 ? ' Seria: **' + result.streak + '**.' : '';
  const levelMessage = levelUp ? '\\n🏅 Awansujesz na rangę **' + trainingRank(result.points) + '**!' : '';
  await interaction.update({
    content: '✅ Dobra odpowiedź! **+' + result.pointsEarned + ' pkt treningu** i **+' + result.coinsEarned + ' monet**.' + streakMessage + '\\nRanga: **' + trainingRank(result.points) + '** · Punkty: **' + result.points + '** · Rekord serii: **' + result.bestStreak + '**.' + levelMessage,
    components: [],
  });
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

const TROPHIES = [
  { id: 'work_100', name: 'Pracowity debiutant', condition: 'Użyj /work 100 razy.' },
  { id: 'work_250', name: 'Mistrz pracy', condition: 'Użyj /work 250 razy.' },
  { id: 'work_500', name: 'Legenda etatów', condition: 'Użyj /work 500 razy.' },
  { id: 'daily_3', name: 'Rytm Inazumy', condition: 'Odbierz /daily przez 3 dni z rzędu.' },
  { id: 'first_team', name: 'Kapitan jedenastki', condition: 'Zapisz swój pierwszy pełny skład.' },
  { id: 'cards_10', name: 'Łowca talentów', condition: 'Zbierz 10 różnych kart.' },
  { id: 'cards_25', name: 'Skaut Inazumy', condition: 'Zbierz 25 różnych kart.' },
];

function trophyNotice(ids = []) {
  if (!ids?.length) return '';
  const names = ids.map((id) => TROPHIES.find((trophy) => trophy.id === id)?.name ?? id);
  return `\n🏆 Zdobywasz trofeum: **${names.join(', ')}**!`;
}

function displayNameOf(user) {
  return user?.globalName ?? user?.username ?? 'Gracz';
}

function playerAccountEmbed(user, name, ownedCards, avatarUrl) {
  const uniqueCards = new Set(user.cards.map((card) => card.name)).size;
  const best = ownedCards.slice().sort((a, b) => b.overall - a.overall)[0];
  const bestName = best ? `${best.name} · ${best.overall} OVR` : 'Brak zdobytej karty';
  const frame = PROFILE_OPTIONS.frames[user.cosmetics?.frame] ?? PROFILE_OPTIONS.frames.standard;
  return new EmbedBuilder()
    .setColor(frame.color)
    .setTitle(`⚽ Karta gracza — ${name}`)
    .setDescription(`**Tytuł:** ${PROFILE_OPTIONS.titles[user.cosmetics?.title]?.name ?? 'Nowy zawodnik'}\n**Najlepsza karta:** ${bestName}`)
    .addFields(
      { name: 'Monety', value: String(user.balance), inline: true },
      { name: 'Kolekcja', value: `${uniqueCards}/${catalog.length}`, inline: true },
      { name: 'Trofea', value: String((user.trophies ?? []).length), inline: true },
      { name: '/work', value: `${user.workCount} użyć`, inline: true },
      { name: 'Seria /daily', value: `${user.dailyStreak}/3 dni`, inline: true },
      { name: 'Mecze', value: 'Statystyki meczowe pojawią się po dodaniu trybu meczów.', inline: false },
    )
    .setThumbnail(avatarUrl);
}

async function showPlayerProfile(interaction) {
  const target = interaction.options.getUser('gracz') ?? interaction.user;
  const account = getUser(interaction.guildId, target.id);
  const ownedCards = account.cards
    .map((card) => catalog.find((player) => player.name === card.name))
    .filter(Boolean);
  const bestCard = ownedCards.slice().sort((a, b) => b.overall - a.overall)[0];
  const embed = playerAccountEmbed(account, displayNameOf(target), ownedCards, target.displayAvatarURL({ extension: 'png', size: 256 }));
  const files = [];
  if (account.profileImage) {
    embed.setImage(account.profileImage);
  } else if (bestCard) {
    const selectedCard = catalog.find((player) => player.name === account.profileCardName) ?? bestCard;
    const imageName = 'karta-profilowa.png';
    const image = await renderPlayerCard(selectedCard);
    embed.setImage(`attachment://${imageName}`);
    files.push(new AttachmentBuilder(Buffer.from(image), { name: imageName }));
  }
  await interaction.reply({ embeds: [embed], files, ephemeral: true });
}

async function setProfilePhoto(interaction) {
  const attachment = interaction.options.getAttachment('zdjecie');
  const user = getUser(interaction.guildId, interaction.user.id);
  if (!attachment) {
    const best = user.cards
      .map((card) => catalog.find((player) => player.name === card.name))
      .filter(Boolean)
      .sort((a, b) => b.overall - a.overall)[0];
    if (!best) {
      await interaction.reply({ content: 'Najpierw zdobądź zawodnika z paczki. Nie masz jeszcze karty, do której można wrócić.', ephemeral: true });
      return;
    }
    setProfileImage(interaction.guildId, interaction.user.id, null, best.name);
    await interaction.reply({ content: `✅ Przywrócono kartę **${best.name}** jako zdjęcie profilu.`, ephemeral: true });
    return;
  }
  if (!attachment.contentType?.startsWith('image/')) {
    await interaction.reply({ content: 'Załącz plik graficzny (PNG, JPG, WEBP lub GIF).', ephemeral: true });
    return;
  }
  if (attachment.size > 8 * 1024 * 1024) {
    await interaction.reply({ content: 'Zdjęcie musi mieć maksymalnie 8 MB.', ephemeral: true });
    return;
  }
  setProfileImage(interaction.guildId, interaction.user.id, attachment.url, null);
  await interaction.reply({ content: '✅ Ustawiono Twoje zdjęcie. Zobacz je przez /profile.', ephemeral: true });
}

async function showTrophyList(interaction) {
  const target = interaction.options.getUser('gracz');
  if (!target) {
    const lines = TROPHIES.map((trophy) => `🏆 **${trophy.name}** — ${trophy.condition}`);
    const embed = new EmbedBuilder()
      .setColor(0xffbe37)
      .setTitle('🏆 Trofea serwera')
      .setDescription(`Trofea zdobywa się za aktywności w grze.\n\n${lines.join('\n')}`)
      .setFooter({ text: 'Po zdobyciu trofeum zostaje ono zapisane na Twoim koncie.' });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  const user = getUser(interaction.guildId, target.id);
  const earned = new Set(user.trophies ?? []);
  const lines = TROPHIES.map((trophy) => `${earned.has(trophy.id) ? '🏆' : '🔒'} **${trophy.name}** — ${trophy.condition}`);
  const embed = new EmbedBuilder()
    .setColor(0xffbe37)
    .setTitle(`🏆 Trofea — ${displayNameOf(target)}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Zdobyte: ${earned.size}/${TROPHIES.length}` });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showPlayerStats(interaction, target) {
  const user = getUser(interaction.guildId, target.id);
  const uniqueCards = new Set(user.cards.map((card) => card.name)).size;
  const teamNames = new Set(user.teams?.[0]?.players ?? user.team?.players ?? []);
  const match = user.matchStats ?? { played: 0, wins: 0, draws: 0, losses: 0 };
  const embed = new EmbedBuilder()
    .setColor(0x168cff)
    .setTitle(`📊 Statystyki — ${displayNameOf(target)}`)
    .setThumbnail(target.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: 'Monety', value: String(user.balance), inline: true },
      { name: 'Karty', value: `${uniqueCards}/${catalog.length}`, inline: true },
      { name: 'Trofea', value: String((user.trophies ?? []).length), inline: true },
      { name: 'Prace /work', value: String(user.workCount), inline: true },
      { name: 'Seria /daily', value: `${user.dailyStreak}/3 dni`, inline: true },
      { name: 'Skład — slot 1', value: `${teamNames.size}/11 zawodników`, inline: true },
      { name: 'Mecze rozegrane', value: String(match.played ?? 0), inline: true },
      { name: 'Wygrane / remisy / porażki', value: `${match.wins ?? 0} / ${match.draws ?? 0} / ${match.losses ?? 0}`, inline: true },
    )
    .setFooter({ text: 'Bilans aktualizuje się po zakończeniu meczu z komendy /mecz.' });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function comparePlayers(interaction) {
  const firstName = interaction.options.getString('zawodnik1');
  const secondName = interaction.options.getString('zawodnik2');
  const first = catalog.find((player) => player.name === firstName);
  const second = catalog.find((player) => player.name === secondName);
  if (!first || !second) {
    await interaction.reply({ content: 'Nie udało się znaleźć obu zawodników w katalogu.', ephemeral: true });
    return;
  }
  if (first.name === second.name) {
    await interaction.reply({ content: 'Wybierz dwóch różnych zawodników do porównania.', ephemeral: true });
    return;
  }
  const imageName = 'porownanie-zawodnikow.png';
  const image = await renderPlayerComparison(first, second);
  const embed = new EmbedBuilder()
    .setColor(0x168cff)
    .setTitle(`⚖️ ${first.name} vs ${second.name}`)
    .setDescription('Porównanie OVERALL i statystyk meczowych.')
    .setImage(`attachment://${imageName}`);
  await interaction.reply({
    embeds: [embed],
    files: [new AttachmentBuilder(Buffer.from(image), { name: imageName })],
    ephemeral: true,
  });
}

async function showStats(interaction) {
  if (!requireGuild(interaction)) return;
  const target = interaction.options.getUser('gracz');
  const name = interaction.options.getString('zawodnik');
  if (target && name) {
    await interaction.reply({ content: 'Wybierz tylko jedną opcję: gracz albo zawodnik.', ephemeral: true });
    return;
  }
  if (!name) {
    await showPlayerStats(interaction, target ?? interaction.user);
    return;
  }
  const player = catalog.find((entry) => entry.name === name);
  if (!player) {
    await interaction.reply({ content: 'Nie znaleziono tego zawodnika.', ephemeral: true });
    return;
  }
  const user = getUser(interaction.guildId, interaction.user.id);
  const owned = user.cards.some((card) => card.name === player.name);
  const element = ELEMENT_NAMES[player.element] ?? player.element ?? 'Nieznany';
  const hissatsu = (player.hissatsu ?? []).map((move) => {
    const details = [move.type, ELEMENT_NAMES[move.element] ?? move.element].filter(Boolean).join(' · ');
    return `• **${move.name}**${details ? ` — ${details}` : ''}`;
  }).join('\n') || 'Brak przypisanych technik.';
  const stats = player.stats ?? {};
  const playerStatsText = [
    `⚽ **KICK** ${stats.kick ?? '—'}  ·  🧤 **GUARD** ${stats.guard ?? '—'}`,
    `🔋 **STAMINA** ${stats.stamina ?? '—'}  ·  💪 **BODY** ${stats.body ?? '—'}`,
    `✨ **TP** ${stats.tp ?? '—'}  ·  🧠 **INTELLIGENCE** ${stats.intelligence ?? '—'}`,
    `🎯 **CONTROL** ${stats.control ?? '—'}  ·  💨 **SPEED** ${stats.speed ?? '—'}`,
  ].join('\n');
  const imageName = 'karta-zawodnika.png';
  const cardImage = await renderPlayerCard(player);
  const embed = new EmbedBuilder()
    .setColor(tierColors[player.tier] ?? 0x168cff)
    .setTitle(`${player.name} — OVERALL ${player.overall}`)
    .setDescription(owned ? 'Masz tę kartę w swojej kolekcji.' : 'Nie masz jeszcze tej karty.')
    .addFields(
      { name: 'Pozycja', value: player.position ?? 'Nieznana', inline: true },
      { name: 'Element', value: element, inline: true },
      { name: 'Rzadkość', value: player.tier ?? 'Nieznana', inline: true },
      { name: 'Hissatsu', value: hissatsu, inline: false },
      { name: 'Statystyki zawodnika', value: playerStatsText, inline: false },
    )
    .setImage(`attachment://${imageName}`);
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
  const unlock = result.unlockedBackground ? `\n🎨 Odblokowano tło profilu: **${event.name}**! Ustawisz je przez /profil.` : '';
  const trophyText = trophyNotice(result.trophies);
  await interaction.reply({
    content: `📅 ${event.name} — dzień serii **${result.streak}/3**. Odbierasz **${result.reward} monet**. Masz **${result.balance} monet**.${unlock}${trophyText}`,
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
    .setDescription(`Wydarzenie zmienia szkołę co tydzień. Odbierz nagrodę przez /daily.\n\n${dailyTrack}`)
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

function arrangeTeam(playerNames, formation, savedPositions = null) {
  const players = playerNames.map((name) => catalog.find((player) => player.name === name)).filter(Boolean);
  const slots = formationGroups(formation);
  if (Array.isArray(savedPositions) && savedPositions.length === 11 && players.length === 11) {
    return players.map((player, index) => ({
      slot: index + 1,
      position: savedPositions[index] ?? slots[index],
      player,
    }));
  }
  const unassigned = [...players];
  return slots.map((position, index) => {
    let playerIndex = unassigned.findIndex((player) => player.position === position);
    if (playerIndex < 0) {
      playerIndex = unassigned.reduce((best, player, i, arr) => player.overall > arr[best].overall ? i : best, 0);
    }
    const [player] = unassigned.splice(playerIndex, 1);
    return { slot: index + 1, position, player };
  });
}

function getSavedTeam(user, slot = 1) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 4) return null;
  return user.teams?.[slot - 1] ?? (slot === 1 ? user.team : null);
}

function teamEmblemRow(user, slot, team) {
  const owned = emblems.filter((emblem) => user.emblems.includes(emblem.id));
  if (!owned.length || !team) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`team-equip-emblem:${slot}`)
    .setPlaceholder(`Herb dla składu ${slot}/4`)
    .addOptions(owned.map((emblem) => ({
      label: emblem.name,
      value: emblem.id,
      default: team.emblem === emblem.id,
    })));
  return [new ActionRowBuilder().addComponents(menu)];
}

async function teamMessage(user, username, slot = 1) {
  const team = getSavedTeam(user, slot);
  if (!team) throw new Error(`Nie ma zapisanego składu w slocie ${slot}/4.`);
  const lineup = arrangeTeam(team.players, team.formation, team.positions);
  if (lineup.length !== 11) throw new Error(`Skład w slocie ${slot}/4 nie zawiera 11 poprawnych zawodników.`);
  const avgOverall = Math.round(lineup.reduce((sum, entry) => sum + entry.player.overall, 0) / lineup.length);
  const emblem = emblems.find((item) => item.id === team.emblem);
  const reserveNames = (team.substitutes ?? []).filter((name) => catalog.some((player) => player.name === name));
  const reserveText = reserveNames.length
    ? reserveNames.map((name, index) => `**SUB${index + 1}:** ${name}`).join('\n')
    : 'Ławka rezerwowych jest pusta.';
  const embed = new EmbedBuilder()
    .setColor(emblem?.color ?? 0x168cff)
    .setTitle(`⚽ Skład ${slot}/4 — ${username}`)
    .setDescription(`Formacja **${team.formation}** · średni OVERALL **${avgOverall}**${emblem ? `\nHerb: **${emblem.name}**` : ''}\n\n**Ławka rezerwowych (${reserveNames.length}/5)**\n${reserveText}\n\nUstawienie zmienisz komendą /team (slot: ${slot}). Herb wybierzesz przez /herb (slot: ${slot}).`)
    .setImage('attachment://squad-pitch.png');
  const image = await renderSquadPitch(lineup, team.formation, emblem);
  return {
    embeds: [embed],
    components: teamEmblemRow(user, slot, team),
    files: [new AttachmentBuilder(Buffer.from(image), { name: 'squad-pitch.png' })],
    attachments: [],
  };
}

const teamBuildSessions = new Map();
const hissatsuChallengeSessions = new Map();
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

function teamBuildClubOptions() {
  return [...new Set(catalog.map((player) => player.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
}

function teamBuildSeasons(player) {
  const explicit = player.season ?? player.season_name ?? player.seasonLabel ?? player.seasons;
  const namedSeason = String(player.name ?? '').match(/\((?:Season|S)\s*(\d+)\)/i)?.[1];
  const raw = explicit ?? player.stat_seasons ?? (namedSeason ? `Season ${namedSeason}` : null);
  const values = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;|]/);
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function teamBuildSeasonOptions() {
  return [...new Set(catalog.flatMap(teamBuildSeasons))].sort((a, b) => a.localeCompare(b, 'pl'));
}

function teamBuildFilterOptions(state) {
  const options = [];
  for (const value of teamBuildPositionOptions()) {
    options.push({ label: `Pozycja · ${value}`, value: `position|${value}`, });
  }
  for (const value of teamBuildElementOptions()) {
    options.push({ label: `Żywioł · ${value}`, value: `element|${value}`, });
  }
  for (const [label, value] of [['Alfabetycznie (A–Z)', 'name'], ['OVERALL (najwyższy)', 'overall-desc'], ['OVERALL (najniższy)', 'overall-asc']]) {
    options.push({ label: `Sortuj · ${label}`, value: `sort|${value}` });
  }
  return options;
}

function teamBuildSourceOptions(state) {
  return [
    { label: 'Wszystkie kluby', value: 'club|Wszystkie', default: state.clubFilter === 'Wszystkie' },
    ...teamBuildClubOptions().slice(0, 24).map((value) => ({
      label: `Klub · ${value}`,
      value: `club|${value}`,
      default: value === state.clubFilter,
    })),
  ];
}

function teamBuildRows(state) {
  const selected = new Set([...state.selected, ...state.substitutes]);
  const allAvailable = catalog.filter((player) => state.ownedNames.includes(player.name) && !selected.has(player.name));
  const addingStarters = state.selected.length < 11;
  let filtered = allAvailable.filter((player) =>
    (state.clubFilter === 'Wszystkie' || player.team === state.clubFilter) &&
    (state.seasonFilter === 'Wszystkie' || teamBuildSeasons(player).includes(state.seasonFilter)) &&
    (state.positionFilter === 'Wszystkie' || player.position === state.positionFilter) &&
    (state.elementFilter === 'Wszystkie' || player.element === state.elementFilter));
  filtered.sort((a, b) => state.sort === 'name'
    ? a.name.localeCompare(b.name, 'pl')
    : state.sort === 'overall-asc'
      ? a.overall - b.overall || a.name.localeCompare(b.name, 'pl')
      : b.overall - a.overall || a.name.localeCompare(b.name, 'pl'));
  const maxPage = Math.max(0, Math.ceil(filtered.length / TEAM_PAGE_SIZE) - 1);
  state.page = Math.min(state.page, maxPage);
  const pagePlayers = filtered.slice(state.page * TEAM_PAGE_SIZE, (state.page + 1) * TEAM_PAGE_SIZE);
  const targetPosition = addingStarters ? state.positions[state.selected.length] : 'ławkę rezerwowych';
  const rows = [];
  if (addingStarters || state.substitutes.length < 5) {
    const playerMenu = new StringSelectMenuBuilder()
      .setCustomId('team-build-player')
      .setPlaceholder(pagePlayers.length ? `Dodaj ${targetPosition.toLocaleLowerCase('pl')} — strona ${state.page + 1}/${maxPage + 1}` : 'Brak wyników — zmień filtry')
      .addOptions(pagePlayers.length
        ? pagePlayers.map((player) => ({
          label: player.name,
          value: player.name,
          description: `${player.team ?? 'Klub nieznany'} · ${player.position} · ${player.element} · OVR ${player.overall}`,
        }))
        : [{ label: 'Brak wyników — zmień filtry', value: '__no_results__', description: 'Zmień aktywne filtry.' }]);
    rows.push(new ActionRowBuilder().addComponents(playerMenu));
  }

  const filterMenu = new StringSelectMenuBuilder()
    .setCustomId('team-build-filter')
    .setPlaceholder(`Filtry: ${state.positionFilter} · ${state.elementFilter} · ${state.sort}`)
    .addOptions(teamBuildFilterOptions(state));
  rows.push(new ActionRowBuilder().addComponents(filterMenu));

  const clubMenu = new StringSelectMenuBuilder()
    .setCustomId('team-build-source')
    .setPlaceholder(`Klub: ${state.clubFilter}`)
    .addOptions(teamBuildSourceOptions(state));
  rows.push(new ActionRowBuilder().addComponents(clubMenu));

  if (teamBuildSeasonOptions().length) {
    const seasonMenu = new StringSelectMenuBuilder()
      .setCustomId('team-build-season')
      .setPlaceholder('Filtruj sezon')
      .addOptions([
        { label: 'Wszystkie sezony', value: 'Wszystkie', default: state.seasonFilter === 'Wszystkie' },
        ...teamBuildSeasonOptions().slice(0, 24).map((value) => ({
          label: value,
          value,
          default: value === state.seasonFilter,
        })),
      ]);
    rows.push(new ActionRowBuilder().addComponents(seasonMenu));
  }

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team-build:back').setLabel('◀ Cofnij').setStyle(ButtonStyle.Secondary).setDisabled(state.selected.length === 0 && state.substitutes.length === 0),
    new ButtonBuilder().setCustomId('team-build:page-prev').setLabel('◀ Karty').setStyle(ButtonStyle.Secondary).setDisabled(state.page === 0),
    new ButtonBuilder().setCustomId('team-build:page-next').setLabel('Karty ▶').setStyle(ButtonStyle.Secondary).setDisabled(state.page >= maxPage),
    new ButtonBuilder().setCustomId('team-build:cancel').setLabel('Anuluj').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('team-build:save').setLabel('Zapisz skład').setStyle(ButtonStyle.Success).setDisabled(state.selected.length !== 11),
  );
  rows.push(buttons);
  return rows;
}
async function renderTeamBuilder(interaction, state) {
  const currentSlot = state.selected.length;
  const positions = state.positions;
  const targetPosition = currentSlot < 11 ? positions[currentSlot] : state.substitutes.length < 5 ? 'Ławka rezerwowych' : 'Gotowe';
  const selectedPreview = state.selected.map((name, index) => {
    const player = catalog.find((entry) => entry.name === name);
    return player ? { ...player, squadPosition: state.positions[index] } : null;
  }).filter(Boolean);
  const preview = await renderSquadBuilderPreview(state.formation, selectedPreview);
  const reserveNames = state.substitutes.map((name) => catalog.find((entry) => entry.name === name)?.name).filter(Boolean);
  const reserveText = reserveNames.length ? reserveNames.map((name, index) => `SUB${index + 1}: ${name}`).join(' · ') : 'jeszcze pusta';
  const embed = new EmbedBuilder()
    .setColor(0x168cff)
    .setTitle(`🧩 Budowanie składu ${state.slot}/4 — ${state.formation}`)
    .setDescription(
      currentSlot < 11
        ? `**Podstawowa jedenastka ${currentSlot + 1}/11: ${targetPosition}**\nWybierz zawodnika z kolekcji. Filtry klubu, sezonu, pozycji, żywiołu i sortowanie są poniżej.`
        : state.substitutes.length < 5
          ? `✅ Podstawowa jedenastka gotowa. Dodaj do **5 rezerwowych** albo zapisz skład już teraz.\n\n**Ławka ${state.substitutes.length}/5:** ${reserveText}`
          : `✅ Skład gotowy.\n\n**Ławka ${state.substitutes.length}/5:** ${reserveText}`,
    )
    .setImage('attachment://squad-builder.png')
    .setFooter({ text: `Klub: ${state.clubFilter} · Sezon: ${state.seasonFilter} · Pozycja: ${state.positionFilter} · Żywioł: ${state.elementFilter} · Sort: ${state.sort}` });
  const payload = {
    content: `Podstawowa jedenastka: **${state.selected.length}/11** · Rezerwa: **${state.substitutes.length}/5** · Niewybrane karty: **${state.ownedNames.length - state.selected.length - state.substitutes.length}**.`,
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
  const slot = interaction.options.getInteger('slot') ?? 1;
  const formation = interaction.options.getString('formacja');
  if (!formation) {
    if (!getSavedTeam(user, slot)) {
      await interaction.reply({ content: `Slot ${slot}/4 jest pusty. Użyj \`/team slot:${slot} formacja:4-4-2\` i wybierz 11 kart.`, ephemeral: true });
      return;
    }
    await interaction.reply({ ...await teamMessage(user, interaction.user.username, slot), ephemeral: true });
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
    slot,
    positions,
    ownedNames,
    selected: [],
    substitutes: [],
    clubFilter: 'Wszystkie',
    seasonFilter: 'Wszystkie',
    positionFilter: positions[0],
    elementFilter: 'Wszystkie',
    sort: 'overall-desc',
    page: 0,
  };
  teamBuildSessions.set(teamBuildKey(interaction), session);
  await renderTeamBuilder(interaction, session);
}

async function showSquad(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  const slot = interaction.options.getInteger('slot') ?? 1;
  if (!getSavedTeam(user, slot)) {
    await interaction.reply({
      content: `Slot ${slot}/4 jest pusty. Użyj /team z slotem ${slot}, wybierz formację i 11 zawodników.`,
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({ ...await teamMessage(user, interaction.user.username, slot), ephemeral: true });
}

async function chooseTeamEmblem(interaction) {
  const user = getUser(interaction.guildId, interaction.user.id);
  const slot = interaction.options.getInteger('slot') ?? 1;
  const team = getSavedTeam(user, slot);
  if (!team) {
    await interaction.reply({ content: `Slot ${slot}/4 jest pusty. Najpierw ustaw skład przez /team z slotem ${slot}.`, ephemeral: true });
    return;
  }
  const owned = emblems.filter((emblem) => user.emblems.includes(emblem.id));
  if (!owned.length) {
    await interaction.reply({ content: 'Nie masz jeszcze herbu. Zdobędziesz go z Hissatsu Pack w `/sklep`.', ephemeral: true });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`team-equip-emblem:${slot}`)
    .setPlaceholder(`Wybierz herb dla składu ${slot}/4`)
    .addOptions(owned.map((emblem) => ({ label: emblem.name, value: emblem.id, default: team.emblem === emblem.id })));
  await interaction.reply({ content: `Wybierz herb dla składu ${slot}/4:`, components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
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
    .setTitle(result.duplicate ? `↩️ Powtórka herbu ${result.emblem.name}` : `✨ Zdobywasz herb ${result.emblem.name}!`)
    .setDescription(`${result.duplicate ? `Ten herb już masz — rekompensata: **+${result.duplicateCoins} monet**.\n` : ''}Pozostało **${result.balance} monet**. Załóż herb na skład komendą /herb.`)
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
    if (interaction.customId === 'team-build-filter' || interaction.customId === 'team-build-source') {
      const [filter, value] = interaction.values[0].split('|');
      if (filter === 'position') state.positionFilter = value;
      else if (filter === 'element') state.elementFilter = value;
      else if (filter === 'sort') state.sort = value;
      else if (filter === 'club') state.clubFilter = value;
      else if (filter === 'season') state.seasonFilter = value;
      state.page = 0;
      await renderTeamBuilder(interaction, state);
      return;
    }
    if (interaction.customId === 'team-build-season') {
      state.seasonFilter = interaction.values[0];
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
      if (state.selected.includes(name) || state.substitutes.includes(name) || !state.ownedNames.includes(name)) {
        await interaction.update({ content: 'Tej karty nie można dodać do składu. Wybierz inną.', embeds: [], components: [] });
        return;
      }
      if (state.selected.length < 11) state.selected.push(name);
      else if (state.substitutes.length < 5) state.substitutes.push(name);
      else {
        await interaction.update({ content: 'Ławka rezerwowych jest już pełna (5/5).', embeds: [], components: [] });
        return;
      }
      state.page = 0;
      state.positionFilter = state.positions[state.selected.length] ?? 'Wszystkie';
      state.elementFilter = 'Wszystkie';
      await renderTeamBuilder(interaction, state);
      return;
    }
  }
  if (interaction.customId.startsWith('team-select:')) {
    const formation = interaction.customId.split(':')[1];
    const result = saveTeam(interaction.guildId, interaction.user.id, formation, interaction.values, null, Number(interaction.customId.split(':')[2] ?? 1));
    if (!result.ok) {
      await interaction.update({ content: 'Nie udało się zapisać składu. Sprawdź, czy wybrano 11 posiadanych zawodników.', components: [], embeds: [] });
      return;
    }
    const user = getUser(interaction.guildId, interaction.user.id);
    await interaction.update({ content: '✅ Skład zapisany. Możesz wybrać herb w menu poniżej.', ...await teamMessage(user, interaction.user.username) });
    return;
  }
  if (interaction.customId.startsWith('team-equip-emblem')) {
    const slot = Number(interaction.customId.split(':')[1] ?? 1);
    const result = setTeamEmblem(interaction.guildId, interaction.user.id, interaction.values[0], slot);
    if (!result.ok) {
      await interaction.update({ content: 'Nie udało się założyć herbu. Najpierw ustaw skład i zdobądź herb.', components: [] });
      return;
    }
    await interaction.update({ content: `✅ Herb założony na skład ${slot}/4.`, ...await teamMessage(getUser(interaction.guildId, interaction.user.id), interaction.user.username, slot) });
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
  console.log(`Bot działa jako ${readyClient.user.tag} | TEAM-SQUAD-SLOTS-SAVE-FIX-v9 | Hissatsu Pack 2026-10-07 | zawodnicy: ${catalog.length} | herby: ${emblems.length}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.respond([]);
        return;
      }
      const focused = interaction.options.getFocused(true);
      if ((interaction.commandName === 'stats' && focused.name === 'zawodnik') || interaction.commandName === 'porownaj') {
        const query = focused.value.toLocaleLowerCase('pl');
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
      if (interaction.customId.startsWith('mecz:')) {
        await matchMode.handleButton(interaction);
      } else if (interaction.customId.startsWith('earn-verify:')) {
        const [, ownerId, deadlineText] = interaction.customId.split(':');
        if (ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'Ta weryfikacja należy do innego gracza.', ephemeral: true });
          return;
        }
        const verification = verifyEarnAction(interaction.guildId, interaction.user.id, Number(deadlineText));
        if (verification.ok) {
          await interaction.update({ content: '✅ Weryfikacja potwierdzona. Możesz dalej korzystać z komend zarobkowych.', components: [] });
        } else if (verification.reason === 'verification-failed') {
          await interaction.update({ content: '⛔ Czas na potwierdzenie minął. Komendy zarobkowe są zablokowane do <t:' + Math.ceil(verification.nextEarnAt / 1000) + ':R>.', components: [] });
        } else {
          await interaction.update({ content: 'Ta weryfikacja jest już nieaktualna. Użyj ponownie /work, /training lub /job.', components: [] });
        }
      } else if (interaction.customId.startsWith('hissatsu:')) {
        await answerHissatsuChallenge(interaction);
      } else if (interaction.customId.startsWith('team-build:')) {
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
          if (state.substitutes.length) state.substitutes.pop();
          else if (state.selected.length) state.selected.pop();
          const nextPosition = state.positions[state.selected.length];
          state.positionFilter = state.selected.length < 11 ? nextPosition ?? 'Wszystkie' : 'Wszystkie';
          state.page = 0;
          await renderTeamBuilder(interaction, state);
        } else if (action === 'page-prev' || action === 'page-next') {
          state.page = Math.max(0, state.page + (action === 'page-next' ? 1 : -1));
          await renderTeamBuilder(interaction, state);
        } else if (action === 'save') {
          const result = saveTeam(interaction.guildId, interaction.user.id, state.formation, state.selected, state.positions, state.slot, state.substitutes);
          if (!result.ok) {
            await interaction.update({ content: 'Nie udało się zapisać składu. Sprawdź, czy wybrano 11 różnych posiadanych kart.', embeds: [], components: [] });
            return;
          }
          teamBuildSessions.delete(teamBuildKey(interaction));
          await interaction.update({ content: `✅ Skład zapisany w slocie ${state.slot}/4.${trophyNotice(result.trophies)} Możesz wybrać herb w menu poniżej.`, ...await teamMessage(getUser(interaction.guildId, interaction.user.id), interaction.user.username, state.slot) });
        }
      } else if (interaction.customId === 'shop-prev' || interaction.customId === 'shop-next') {
        await showShop(interaction, interaction.customId === 'shop-next' ? 1 : 0, true);
      } else if (interaction.customId.startsWith('collection-page:')) {
        const page = Number(interaction.customId.split(':')[1]);
        await showCollection(interaction, page, true);
      } else if (interaction.customId === 'collection-prev' || interaction.customId === 'collection-next') {
        await showCollection(interaction, interaction.customId === 'collection-next' ? 1 : 0, true);
      } else if (interaction.customId === 'shop-odds') {
        await showPackOdds(interaction);
      } else if (interaction.customId === 'buy-player-pack') {
        await openPack(interaction);
      } else if (interaction.customId === 'buy-hissatsu-pack') {
        await buyHissatsuPack(interaction);
      }
      return;
    }
    if (interaction.isStringSelectMenu()) {
      if (!requireGuild(interaction) || !(await requireAdmin(interaction)) || !(await requireGameAccess(interaction))) return;
      if (interaction.customId.startsWith('mecz-tech:')) await matchMode.handleTechnique(interaction);
      else if (interaction.customId.startsWith('mecz-pass-receiver:') || interaction.customId.startsWith('mecz-pass-defender:')) await matchMode.handlePassSelection(interaction);
      else if (interaction.customId.startsWith('mecz-sub-out:') || interaction.customId.startsWith('mecz-sub-in:')) await matchMode.handleSubstitution(interaction);
      else await handleGameSelect(interaction);
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
        await earn(interaction, 'work');
        break;
      case 'training':
        await earn(interaction, 'training');
        break;
      case 'job':
        await earn(interaction, 'job');
        break;
      case 'free':
        await claimFree(interaction);
        break;
      case 'wyzwanie':
        await startHissatsuChallengeCommand(interaction);
        break;
      case 'saldo':
        await showBalance(interaction);
        break;
      case 'save':
        await sendSave(interaction);
        break;
      case 'import_baza':
        await importDatabase(interaction);
        break;
      case 'ruletke':
        await playRouletteRound(interaction);
        break;
      case 'stats':
        await showStats(interaction);
        break;
      case 'porownaj':
        await comparePlayers(interaction);
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
      case 'profile':
        await showPlayerProfile(interaction);
        break;
      case 'profile_image':
        await setProfilePhoto(interaction);
        break;
      case 'trophy_list':
        await showTrophyList(interaction);
        break;
      case 'team':
        await showTeam(interaction);
        break;
      case 'mecz':
        await matchMode.start(interaction);
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
