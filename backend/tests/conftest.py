from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from structured_backend.db.base import Base
from structured_backend.config import Settings, settings
from structured_backend.db.session import get_db
from structured_backend.main import app as fastapi_app
from structured_backend.models import (  # noqa: F401
    Alert,
    ApiKey,
    Series,
    SeriesCompletion,
    SeriesException,
    Task,
    User,
)
from structured_backend.services import users as user_service


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "real_allowlist: use production Discord allowlist logic",
    )


@pytest.fixture(autouse=True)
def _allow_discord_in_tests(request, monkeypatch):
    if request.node.get_closest_marker("real_allowlist"):
        return
    monkeypatch.setattr(
        Settings,
        "is_discord_allowed",
        lambda self, _discord_id: True,
    )


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def app(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    fastapi_app.dependency_overrides[get_db] = override_get_db
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def api_headers(db_session: AsyncSession) -> dict[str, str]:
    _user, raw = await user_service.link_widget_token(
        db_session, discord_id="999000111", timezone="Asia/Kolkata"
    )
    return {"X-Discord-Id": "999000111", "X-Widget-Token": raw}


@pytest_asyncio.fixture
async def client(app) -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
