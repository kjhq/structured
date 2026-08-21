"""Series client_request_id for Discord create idempotency."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_series_client_request_id"
down_revision: str | None = "0003_bot_companion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("series")}
    uqs = {c["name"] for c in inspector.get_unique_constraints("series")}
    idxs = {ix["name"] for ix in inspector.get_indexes("series")}
    with op.batch_alter_table("series") as batch:
        if "client_request_id" not in cols:
            batch.add_column(sa.Column("client_request_id", sa.String(length=128), nullable=True))
        if (
            "uq_series_user_client_request" not in uqs
            and "uq_series_user_client_request" not in idxs
        ):
            batch.create_unique_constraint(
                "uq_series_user_client_request", ["user_id", "client_request_id"]
            )


def downgrade() -> None:
    with op.batch_alter_table("series") as batch:
        batch.drop_constraint("uq_series_user_client_request", type_="unique")
        batch.drop_column("client_request_id")
