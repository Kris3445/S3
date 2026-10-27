from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    discord_token: str
    discord_guild_id: int | None = None
    database_url: str = "postgresql+asyncpg://manager:change-me@localhost:5432/inazuma_manager"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
