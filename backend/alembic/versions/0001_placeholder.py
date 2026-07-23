"""empty initial revision placeholder — replaced by autogenerate when postgres is up"""

from collections.abc import Sequence

revision: str = "0001_users_keys"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
