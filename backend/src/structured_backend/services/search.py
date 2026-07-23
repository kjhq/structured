from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from structured_backend.models.task import Task
from structured_backend.models.user import User


async def search_tasks(db: AsyncSession, user: User, q: str, *, limit: int = 50) -> list[Task]:
    query = q.strip()
    if not query:
        return []
    result = await db.execute(
        select(Task)
        .options(selectinload(Task.alerts))
        .where(
            Task.user_id == user.id,
            Task.deleted_at.is_(None),
            Task.title.ilike(f"%{query}%"),
        )
        .order_by(Task.updated_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
