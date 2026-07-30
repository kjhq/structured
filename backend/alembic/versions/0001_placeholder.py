"""Create base schema on fresh databases; noop when tables already exist."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_users_keys"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing production DBs were created via create_all + ad-hoc ALTERs.
    # Stamp this revision on those DBs, then run 0002 for incremental upgrades.
    # Fresh DBs get the ORM metadata created here (then 0002 is idempotent).
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" in inspector.get_table_names():
        return
    from structured_backend.db.base import Base
    import structured_backend.models  # noqa: F401

    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    pass
