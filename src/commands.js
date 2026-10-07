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
    .setName('profile')
    .setDescription('Pokaż kartę gracza i statystyki swoje lub innego gracza.')
    .addUserOption((option) => option.setName('gracz').setDescription('Gracz, którego profil chcesz zobaczyć.')),
  new SlashCommandBuilder()
    .setName('profile_image')
    .setDescription('Ustaw zdjęcie swojej karty albo wróć do karty zawodnika z kolekcji.')
    .addAttachmentOption((option) => option.setName('zdjecie').setDescription('Zdjęcie na Twoją kartę. Puste pole przywraca kartę z kolekcji.')),
  new SlashCommandBuilder()
    .setName('trophy_list')
    .setDescription('Pokaż trofea serwera lub trofea wybranego gracza.')
    .addUserOption((option) => option.setName('gracz').setDescription('Gracz, którego trofea chcesz zobaczyć.')),
  new SlashCommandBuilder()
    .setName('team')
    .setDescription('Zbuduj skład: wybierz formację i 11 zawodników.')
    .addIntegerOption((option) => option
      .setName('slot')
      .setDescription('Wybierz jeden z czterech zapisanych składów.')
      .addChoices(
        { name: 'Slot 1', value: 1 },
        { name: 'Slot 2', value: 2 },
        { name: 'Slot 3', value: 3 },
        { name: 'Slot 4', value: 4 },
      ))
    .addStringOption((option) => option
      .setName('formacja')
      .setDescription('Wybierz formację dla składu.')
      .addChoices(
        { name: '4-4-2', value: '4-4-2' },
        { name: '4-3-3', value: '4-3-3' },
        { name: '3-5-2', value: '3-5-2' },
      )),
  new SlashCommandBuilder().setName('squad').setDescription('Pokaż zbudowany skład na boisku.').addIntegerOption((option) => option
      .setName('slot')
      .setDescription('Wybierz jeden z czterech zapisanych składów.')
      .addChoices(
        { name: 'Slot 1', value: 1 },
        { name: 'Slot 2', value: 2 },
        { name: 'Slot 3', value: 3 },
        { name: 'Slot 4', value: 4 },
      )),
  new SlashCommandBuilder().setName('herb').setDescription('Załóż zdobyty herb na wybrany skład.').addIntegerOption((option) => option
      .setName('slot')
      .setDescription('Wybierz jeden z czterech zapisanych składów.')
      .addChoices(
        { name: 'Slot 1', value: 1 },
        { name: 'Slot 2', value: 2 },
        { name: 'Slot 3', value: 3 },
        { name: 'Slot 4', value: 4 },
      )),
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
    .setDescription('Pokaż statystyki gracza lub szczegóły zawodnika.')
    .addUserOption((option) => option.setName('gracz').setDescription('Gracz, którego statystyki chcesz zobaczyć.'))
    .addStringOption((option) => option
      .setName('zawodnik')
      .setDescription('Zawodnik, którego kartę chcesz zobaczyć.')
      .setAutocomplete(true)),
];

export const commands = commandBuilders.map((command) => {
  command.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  return command.toJSON();
});
