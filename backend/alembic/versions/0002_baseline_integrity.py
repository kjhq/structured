"""Pending widget token columns + series completion uniqueness (idempotent)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_baseline_integrity"
down_revision: str | None = "0001_users_keys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_cols = {c["name"] for c in inspector.get_columns("users")}

    with op.batch_alter_table("users") as batch:
        if "pending_widget_token_hash" not in user_cols:
            batch.add_column(sa.Column("pending_widget_token_hash", sa.String(length=64), nullable=True))
        if "pending_widget_token_id" not in user_cols:
            batch.add_column(sa.Column("pending_widget_token_id", sa.String(length=64), nullable=True))
        if "pending_widget_token_expires_at" not in user_cols:
            batch.add_column(
                sa.Column(
                    "pending_widget_token_expires_at",
                    sa.DateTime(timezone=True),
                    nullable=True,
                )
            )

    # Deduplicate before unique constraint (keep earliest completed_at).
    op.execute(
        sa.text(
            """
            DELETE FROM series_completions
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY series_id, occurrence_day
                               ORDER BY completed_at ASC NULLS LAST, id ASC
                           ) AS rn
                    FROM series_completions
                ) ranked
                WHERE rn > 1
            )
            """
        )
    )

    existing = {
        c["name"]
        for c in inspector.get_unique_constraints("series_completions")
    }
    # SQLite may also expose UniqueConstraint via indexes
    existing_indexes = {ix["name"] for ix in inspector.get_indexes("series_completions")}
    if (
        "uq_series_completions_series_day" not in existing
        and "uq_series_completions_series_day" not in existing_indexes
    ):
        try:
            op.create_unique_constraint(
                "uq_series_completions_series_day",
                "series_completions",
                ["series_id", "occurrence_day"],
            )
        except Exception:
            # Constraint may already exist under a different inspector view (e.g. create_all).
            pass


def downgrade() -> None:
    try:
        op.drop_constraint(
            "uq_series_completions_series_day", "series_completions", type_="unique"
        )
    except Exception:
        pass
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "pending_widget_token_expires_at" in user_cols:
            batch.drop_column("pending_widget_token_expires_at")
        if "pending_widget_token_id" in user_cols:
            batch.drop_column("pending_widget_token_id")
        if "pending_widget_token_hash" in user_cols:
            batch.drop_column("pending_widget_token_hash")
