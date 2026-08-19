"""Pending settings / series alerts / notification deliveries."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_bot_companion"
down_revision: str | None = "0002_baseline_integrity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        additions = {
            "briefing_morning_time": sa.Column("briefing_morning_time", sa.Time(), nullable=True),
            "briefing_evening_time": sa.Column("briefing_evening_time", sa.Time(), nullable=True),
            "quiet_hours_start": sa.Column("quiet_hours_start", sa.Time(), nullable=True),
            "quiet_hours_end": sa.Column("quiet_hours_end", sa.Time(), nullable=True),
            "reminders_enabled": sa.Column(
                "reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
            ),
            "overdue_enabled": sa.Column(
                "overdue_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            "guild_mode": sa.Column(
                "guild_mode", sa.String(length=16), nullable=False, server_default="all"
            ),
            "planner_channel_id": sa.Column("planner_channel_id", sa.String(length=32), nullable=True),
            "capture_images": sa.Column(
                "capture_images", sa.Boolean(), nullable=False, server_default=sa.true()
            ),
            "capture_voice": sa.Column(
                "capture_voice", sa.Boolean(), nullable=False, server_default=sa.true()
            ),
            "presence_enabled": sa.Column(
                "presence_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
        }
        for name, col in additions.items():
            if name not in user_cols:
                batch.add_column(col)

    alert_cols = {c["name"] for c in inspector.get_columns("alerts")}
    with op.batch_alter_table("alerts") as batch:
        if "series_id" not in alert_cols:
            batch.add_column(sa.Column("series_id", sa.Uuid(), nullable=True))
            batch.create_index("ix_alerts_series_id", ["series_id"])
            batch.create_foreign_key(
                "fk_alerts_series_id",
                "series",
                ["series_id"],
                ["id"],
                ondelete="CASCADE",
            )
        batch.alter_column("task_id", existing_type=sa.Uuid(), nullable=True)
        batch.create_check_constraint(
            "ck_alerts_exactly_one_owner",
            "(CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN series_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
        )

    if "notification_deliveries" not in inspector.get_table_names():
        op.create_table(
            "notification_deliveries",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("kind", sa.String(32), nullable=False),
            sa.Column("source_key", sa.String(256), nullable=False),
            sa.Column("fire_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("discord_message_id", sa.String(32), nullable=True),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("skip_reason", sa.String(64), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint("user_id", "source_key", name="uq_notification_user_source"),
        )
        op.create_index("ix_notification_deliveries_user_id", "notification_deliveries", ["user_id"])
        op.create_index("ix_notification_deliveries_fire_at", "notification_deliveries", ["fire_at"])
        op.execute(
            "CREATE INDEX ix_notification_deliveries_due ON notification_deliveries "
            "(status, fire_at) WHERE status IN ('pending', 'claimed')"
        )


def downgrade() -> None:
    op.drop_table("notification_deliveries")
