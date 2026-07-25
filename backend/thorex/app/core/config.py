from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="THOREX_", env_file=".env", extra="ignore")
    mode: str = "mock"            # mock | local | cloud
    environment: str = "dev"
    model_cache_dir: str = "/tmp/thorex-models"

@lru_cache
def get_settings() -> Settings:
    return Settings()
