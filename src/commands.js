import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const commandBuilders = [
  new SlashCommandBuilder().setName('sklep').setDescription('Otwórz sklep i przełączaj paczki strzałkami.'),
  new SlashCommandBuilder().setName('work').setDescription('Wykonaj pracę i zarób monety oraz postęp osiągnięć.'),
  new SlashCommandBuilder().setName('training').setDescription('Trenuj i zarób monety.'),
  new SlashCommandBuilder().setName('job').setDescription('Idź do pracy i zarób monety.'),
  new SlashCommandBuilder().setName('free').setDescription('Odbierz jednorazową nagrodę 8000 monet.'),
  new SlashCommandBuilder().setName('daily').setDescription('Odbierz dzienną nagrodę z kalendarza wydarzenia.'),
  new SlashCommandBuilder().setName('calendar').setDescription('Pokaż kalendarz wydarzeń i dzienne nagrody.'),
  new SlashCommandBuilder().setName('osiągnięcia').setDescription('Sprawdź postęp osiągnięć za pracę.'),
  new SlashCommandBuilder().setName('saldo').setDescription('Sprawdź swoje monety.'),
  new SlashCommandBuilder().setName('profil').setDescription('Zobacz profil i ustaw odblokowane ozdoby.'),
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Zbuduj skład: wybierz formację i 11 zawodników.')
    .addStringOption((option) => option
      .setName('formacja')
      .setDescription('Wybierz formację dla składu.')
      .addChoices(
        { name: '4-4-2', value: '4-4-2' },
        { name: '4-3-3', value: '4-3-3' },
        { name: '3-5-2', value: '3-5-2' },
      )),
  new SlashCommandBuilder().setName('squad').setDescription('Pokaż zbudowany skład na boisku.'),
  new SlashCommandBuilder().setName('herb').setDescription('Załóż zdobyty herb na swój skład.'),
  new SlashCommandBuilder()
    .setName('ruletke')
    .setDescription('Postaw do 100 monet na kolor w ruletce.')
    .addIntegerOption((option) => option
      .setName('stawka')
      .setDescription('Ile monet stawiasz (maksymalnie 100).')
      .setMinValue(1)
      .setMaxValue(100)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('kolor')
      .setDescription('Wybierz czerwone albo czarne.')
      .addChoices(
        { name: 'Czerwone', value: 'red' },
        { name: 'Czarne', value: 'black' },
      )
      .setRequired(true)),
  new SlashCommandBuilder().setName('kolekcja').setDescription('Zobacz planszę zdobytych zawodników.'),
  new SlashCommandBuilder().setName('save').setDescription('Wyślij prywatną kopię zapisu kolekcji i monet.'),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Zobacz kartę i statystyki zawodnika.')
    .addStringOption((option) => option
      .setName('zawodnik')
      .setDescription('Wpisz lub wybierz zawodnika.')
      .setAutocomplete(true)
      .setRequired(true)),
];

export const commands = commandBuilders.map((command) => {
  command.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  return command.toJSON();
});
