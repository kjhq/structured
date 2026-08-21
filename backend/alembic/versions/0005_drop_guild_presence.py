"""Drop guild_mode, planner_channel_id, presence_enabled (DM-only bot v2)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_drop_guild_presence"
down_revision: str | None = "0004_series_client_request_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "presence_enabled" in cols:
            batch.drop_column("presence_enabled")
        if "planner_channel_id" in cols:
            batch.drop_column("planner_channel_id")
        if "guild_mode" in cols:
            batch.drop_column("guild_mode")


def downgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "guild_mode" not in cols:
            batch.add_column(
                sa.Column("guild_mode", sa.String(length=16), nullable=False, server_default="all")
            )
        if "planner_channel_id" not in cols:
            batch.add_column(sa.Column("planner_channel_id", sa.String(length=32), nullable=True))
        if "presence_enabled" not in cols:
            batch.add_column(
                sa.Column("presence_enabled", sa.Boolean(), nullable=False, server_default=sa.false())
            )
