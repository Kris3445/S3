import logging

import discord
from discord import app_commands
from sqlalchemy import func, select

from bot.config import settings
from bot.db.models import Club, League, Player, World
from bot.db.session import SessionFactory, create_schema, dispose_engine
from bot.services.catalog import load_catalog
from bot.services.roster_rules import validate_initial_pool

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
log = logging.getLogger("inazuma-manager")


class InazumaManager(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=discord.Intents.none())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        await create_schema()
        if settings.discord_guild_id:
            guild = discord.Object(id=settings.discord_guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()

    async def close(self) -> None:
        await dispose_engine()
        await super().close()


client = InazumaManager()


@client.tree.command(name="manager", description="Pokaż stan Inazuma Eleven Manager.")
async def manager_status(interaction: discord.Interaction) -> None:
    async with SessionFactory() as session:
        world = await session.scalar(select(World).where(World.guild_id == interaction.guild_id))
        if world is None:
            await interaction.response.send_message(
                "Świat kariery nie został jeszcze utworzony. Administrator może użyć /kariera-start.",
                ephemeral=True,
            )
            return
        player_count = await session.scalar(
            select(func.count(Player.id)).where(Player.world_id == world.id)
        )
        club_count = await session.scalar(
            select(func.count(Club.id)).where(Club.world_id == world.id)
        )
        await interaction.response.send_message(
            f"**Inazuma Eleven Manager**\nSezon: {world.season} · Dzień gry: {world.game_day}\n"
            f"Kluby: {club_count or 0} · Zawodnicy w bazie świata: {player_count or 0}\n"
            f"Czas gry: {'wstrzymany' if world.paused else 'aktywny'}"
        )


@client.tree.command(name="kariera-start", description="Przygotuj nowy świat kariery (administrator).")
@app_commands.default_permissions(administrator=True)
async def career_start(interaction: discord.Interaction) -> None:
    if interaction.guild_id is None:
        await interaction.response.send_message("Użyj tej komendy na serwerze.", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True, thinking=True)

    try:
        catalog = load_catalog()
    except (OSError, ValueError) as error:
        await interaction.followup.send(f"Nie udało się sprawdzić katalogu zawodników: {error}")
        return

    enough, message = validate_initial_pool(catalog)
    if not enough:
        await interaction.followup.send(
            f"**Nie uruchomiono kariery.** {message}\n"
            "To zabezpieczenie zapobiega kopiowaniu postaci lub tworzeniu niepełnych składów. "
            "Dotychczasowe dane nie zostały zmienione."
        )
        return

    async with SessionFactory() as session:
        existing = await session.scalar(
            select(World).where(World.guild_id == interaction.guild_id)
        )
        if existing is not None:
            await interaction.followup.send(
                "Świat już istnieje. Nie nadpisuję go ani nie resetuję zapisów."
            )
            return

        world = World(guild_id=interaction.guild_id, name="Inazuma", paused=True)
        session.add(world)
        await session.flush()
        for number, name, human_managed in (
            (1, "Liga 1", True),
            (2, "Liga 2", False),
            (3, "Liga 3", False),
        ):
            session.add(League(world_id=world.id, number=number, name=name, human_managed=human_managed))
        await session.commit()

    await interaction.followup.send(
        "Utworzono podstawowy świat z trzema ligami. Kolejnym krokiem będzie utworzenie klubów, "
        "rozdanie unikalnych zawodników i wygenerowanie terminarza. Czas gry pozostaje wstrzymany."
    )


@client.event
async def on_ready() -> None:
    log.info("Zalogowano jako %s", client.user)


def main() -> None:
    client.run(settings.discord_token)


if __name__ == "__main__":
    main()
