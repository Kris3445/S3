import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder().setName('sklep').setDescription('Otwórz sklep z paczką S2.'),
  new SlashCommandBuilder().setName('work').setDescription('Wykonaj pracę i zarób monety.'),
  new SlashCommandBuilder().setName('training').setDescription('Trenuj i zarób monety.'),
  new SlashCommandBuilder().setName('job').setDescription('Idź do pracy i zarób monety.'),
  new SlashCommandBuilder().setName('free').setDescription('Odbierz jednorazową nagrodę 8000 monet.'),
  new SlashCommandBuilder().setName('saldo').setDescription('Sprawdź swoje monety.'),
  new SlashCommandBuilder().setName('kolekcja').setDescription('Zobacz pełną planszę zawodników z kolekcji.'),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Zobacz kartę i statystyki zawodnika.')
    .addStringOption((option) => option
      .setName('zawodnik')
      .setDescription('Wybierz zawodnika.')
      .setAutocomplete(true)
      .setRequired(true)),
].map((command) => command
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON());
