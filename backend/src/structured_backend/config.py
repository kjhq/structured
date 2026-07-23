from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://structured:structured@localhost:5432/structured"
    secret_key: str = "change-me"
    bot_api_secret: str = "dev-bot-secret"
    api_key: str = "dev-api-key"
    cors_origins: list[str] = ["http://localhost:3000"]


settings = Settings()
