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
} from 'discord.js';
import {
  ASSETS,
  EARN_REWARD,
  GLOBAL_COOLDOWN_MS,
  PACK_PRICE,
  PACK_SIZE,
  TOKEN,
} from './config.js';
import { buyPack, claimFreeReward, claimReward, getUser } from './economy.js';

if (!TOKEN) {
  console.error('Brakuje DISCORD_TOKEN. Skopiuj .env.example do .env i uzupełnij token.');
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(path.join(ASSETS, 'katalog.json'), 'utf8'));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const packButtonId = 'buy_s2_pack';
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

function cardEmbed(card, index, imageName) {
  const embed = new EmbedBuilder()
    .setColor(tierColors[card.tier] ?? 0x5b8cff)
    .setTitle(`${card.name}  •  OVERALL ${card.overall}`)
    .setDescription(`Rzadkość: **${card.tier}**`)
    .setImage(`attachment://${imageName}`)
    .setFooter({ text: `Karta ${index + 1}/${PACK_SIZE} • Inazuma Eleven S2` });
  return embed;
}

async function showShop(interaction) {
  const imageName = 'paczka_s2.png';
  const embed = new EmbedBuilder()
    .setColor(0x168cff)
    .setTitle('⚡ Sklep Inazuma Eleven — paczka S2')
    .setDescription(
      `Jedna paczka zawiera **${PACK_SIZE} zawodników**.\n` +
      `Cena: **${PACK_PRICE} monet**\n\n` +
      'Każde losowanie korzysta z podanych szans. Powtórzeni zawodnicy są możliwi.',
    )
    .setImage(`attachment://${imageName}`)
    .setFooter({ text: 'Zarabiaj przez /work, /training lub /job albo odbierz jednorazowe /free.' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(packButtonId)
      .setLabel(`Kup paczkę — ${PACK_PRICE} monet`)
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Primary),
  );
  await interaction.reply({ embeds: [embed], components: [row], files: [new AttachmentBuilder(path.join(ASSETS, imageName))] });
}

async function earn(interaction, activity) {
  if (!requireGuild(interaction)) return;
  const result = claimReward(interaction.guildId, interaction.user.id, EARN_REWARD, GLOBAL_COOLDOWN_MS);
  if (!result.ok) {
    const timestamp = Math.ceil(result.nextEarnAt / 1000);
    await interaction.reply({
      content: `Masz wspólną przerwę na zarabianie. Spróbuj ponownie <t:${timestamp}:R>.`,
      ephemeral: true,
    });
    return;
  }
  await interaction.reply(
    `💰 ${interaction.user} ${activity}. Dostajesz **${EARN_REWARD} monet**. ` +
    `Masz teraz **${result.balance} monet**. Następna praca za minutę.`,
  );
}

async function openPack(interaction) {
  if (!requireGuild(interaction)) return;
  if (!(await requireAdmin(interaction))) return;
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
    content: `🎁 ${interaction.user} otwiera paczkę S2! Pozostało **${result.balance} monet**.`,
    files: [animation],
  });

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const delay = index === 0 ? OPENING_ANIMATION_MS : CARD_REVEAL_DELAY_MS;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const sourcePath = path.join(ASSETS, card.image);
    const imageName = `zawodnik-${index + 1}.png`;
    await interaction.followUp({
      content: index === 0 ? '⚡ Zawodnicy z paczki pojawiają się po kolei:' : undefined,
      embeds: [cardEmbed(card, index, imageName)],
      files: [new AttachmentBuilder(sourcePath, { name: imageName })],
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

async function showCollection(interaction) {
  if (!requireGuild(interaction)) return;
  const user = getUser(interaction.guildId, interaction.user.id);
  const recent = user.cards.slice(-10).reverse();
  if (recent.length === 0) {
    await interaction.reply({ content: 'Twoja kolekcja jest pusta. Kup paczkę w `/sklep`!', ephemeral: true });
    return;
  }
  const lines = recent.map((card, index) =>
    `**${index + 1}. ${card.name}** — OVERALL ${card.overall} · ${card.tier}`,
  );
  const embed = new EmbedBuilder()
    .setColor(0x168cff)
    .setTitle(`⚽ Kolekcja ${interaction.user.username}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Pokazano ${recent.length} z ${user.cards.length} kart.` });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot działa jako ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === packButtonId) {
      await openPack(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (!requireGuild(interaction) || !(await requireAdmin(interaction))) return;

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
      case 'saldo': {
        if (!requireGuild(interaction)) return;
        const user = getUser(interaction.guildId, interaction.user.id);
        await interaction.reply(`💰 Masz **${user.balance} monet**.`);
        break;
      }
      case 'kolekcja':
        await showCollection(interaction);
        break;
      default:
        await interaction.reply({ content: 'Nie znam tej komendy.', ephemeral: true });
    }
  } catch (error) {
    console.error('Błąd obsługi interakcji:', error);
    const response = { content: 'Coś się nie udało. Sprawdź logi bota i spróbuj ponownie.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

client.login(TOKEN);
