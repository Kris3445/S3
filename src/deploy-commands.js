import { REST, Routes } from 'discord.js';
import { CLIENT_ID, GUILD_ID, TOKEN } from './config.js';
import { commands } from './commands.js';

if (!TOKEN || !CLIENT_ID) {
  console.error('Uzupełnij DISCORD_TOKEN i CLIENT_ID w pliku .env.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);
try {
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });

    // Remove global copies of these commands so they do not duplicate the guild versions.
    const currentNames = new Set(commands.map((command) => command.name));
    for (const oldName of ['druzyna', 'kalendarz', 'ruletka']) currentNames.add(oldName);
    const globalCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
    for (const command of globalCommands) {
      if (currentNames.has(command.name)) {
        await rest.delete(Routes.applicationCommand(CLIENT_ID, command.id));
      }
    }
    console.log(`Komendy dodane na serwerze ${GUILD_ID}: ${commands.map((command) => `/${command.name}`).join(', ')}`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`Komendy globalne dodane: ${commands.map((command) => `/${command.name}`).join(', ')}. Ich pojawienie się może chwilę potrwać.`);
  }
} catch (error) {
  console.error('Nie udało się dodać komend:', error);
  process.exitCode = 1;
}
