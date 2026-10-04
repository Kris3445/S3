import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder().setName('sklep').setDescription('Otwórz sklep z paczką S2.'),
  new SlashCommandBuilder().setName('work').setDescription('Wykonaj pracę i zarób monety.'),
  new SlashCommandBuilder().setName('training').setDescription('Trenuj i zarób monety.'),
  new SlashCommandBuilder().setName('job').setDescription('Idź do pracy i zarób monety.'),
  new SlashCommandBuilder().setName('saldo').setDescription('Sprawdź swoje monety.'),
  new SlashCommandBuilder().setName('kolekcja').setDescription('Zobacz ostatnie karty w swojej kolekcji.'),
].map((command) => command.toJSON());
