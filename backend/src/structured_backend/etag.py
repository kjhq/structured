from __future__ import annotations

from collections.abc import Iterable
from hashlib import sha256


def content_etag(parts: Iterable[str | None]) -> str:
    body = "|".join("" if p is None else str(p) for p in parts)
    digest = sha256(body.encode()).hexdigest()[:16]
    return f'"{digest}"'
