import pytest

from structured_backend.services import users as user_service


@pytest.mark.asyncio
async def test_ensure_user_for_discord_is_idempotent(db_session):
    u1 = await user_service.ensure_user_for_discord(
        db_session, discord_id="111", timezone="Asia/Kolkata"
    )
    u2 = await user_service.ensure_user_for_discord(
        db_session, discord_id="111", timezone="Asia/Kolkata"
    )
    assert u1.id == u2.id
    assert u1.discord_id == "111"
    assert u1.timezone == "Asia/Kolkata"


@pytest.mark.asyncio
async def test_link_widget_token_verifies_and_relink_invalidates(db_session):
    user, raw1 = await user_service.link_widget_token(
        db_session, discord_id="222", timezone="UTC"
    )
    assert raw1.startswith("wt_")
    found = await user_service.get_user_by_discord_and_token(db_session, "222", raw1)
    assert found is not None and found.id == user.id

    _, raw2 = await user_service.link_widget_token(
        db_session, discord_id="222", timezone="UTC"
    )
    assert await user_service.get_user_by_discord_and_token(db_session, "222", raw1) is None
    assert await user_service.get_user_by_discord_and_token(db_session, "222", raw2) is not None


@pytest.mark.asyncio
async def test_link_does_not_auto_adopt_orphan_user(db_session):
    """Orphan (no discord_id) users must not be claimed by a new Discord link."""
    orphan, _ = await user_service.create_user(db_session, timezone="UTC", label="orphan")
    assert orphan.discord_id is None
    linked, raw = await user_service.link_widget_token(
        db_session, discord_id="333", timezone="UTC"
    )
    assert linked.id != orphan.id
    assert linked.discord_id == "333"
    assert await user_service.get_user_by_discord_and_token(db_session, "333", raw) is not None


@pytest.mark.asyncio
async def test_prepare_activate_keeps_old_token_until_activate(db_session):
    user, raw_old = await user_service.link_widget_token(
        db_session, discord_id="444", timezone="UTC"
    )
    _, raw_pending, pending_id = await user_service.prepare_widget_token(
        db_session, discord_id="444", timezone="UTC"
    )
    assert await user_service.get_user_by_discord_and_token(db_session, "444", raw_old) is not None
    assert await user_service.get_user_by_discord_and_token(db_session, "444", raw_pending) is None

    await user_service.activate_widget_token(
        db_session, discord_id="444", pending_id=pending_id
    )
    assert await user_service.get_user_by_discord_and_token(db_session, "444", raw_old) is None
    assert await user_service.get_user_by_discord_and_token(db_session, "444", raw_pending) is not None
    assert user.id  # still same user row after activate
