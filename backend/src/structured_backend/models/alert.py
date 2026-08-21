from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from structured_backend.db.base import Base

if TYPE_CHECKING:
    from structured_backend.models.series import Series
    from structured_backend.models.task import Task


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN series_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_alerts_exactly_one_owner",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tasks.id"), nullable=True, index=True
    )
    series_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("series.id"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="start")
    offset_minutes: Mapped[int | None] = mapped_column(Integer)

    task: Mapped[Task | None] = relationship(back_populates="alerts")
    series: Mapped[Series | None] = relationship(back_populates="alerts")
