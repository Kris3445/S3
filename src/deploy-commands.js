import { REST, Routes } from 'discord.js';
import { CLIENT_ID, GUILD_ID, TOKEN } from './config.js';
import { commands } from './commands.js';

if (!TOKEN || !CLIENT_ID) {
  console.error('Uzupełnij DISCORD_TOKEN i CLIENT_ID w pliku .env.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);
const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

try {
  await rest.put(route, { body: commands });
  console.log(GUILD_ID
    ? `Komendy dodane na serwerze ${GUILD_ID}.`
    : 'Komendy globalne dodane. Ich pojawienie się może chwilę potrwać.');
} catch (error) {
  console.error('Nie udało się dodać komend:', error);
  process.exitCode = 1;
}
