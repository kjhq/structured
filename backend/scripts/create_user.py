#!/usr/bin/env python3
"""Create a user and print a one-time API key."""

from __future__ import annotations

import argparse
import asyncio
import sys

from structured_backend.db.session import SessionLocal
from structured_backend.services.users import create_user


async def main() -> int:
    parser = argparse.ArgumentParser(description="Create a structured user + API key")
    parser.add_argument("--timezone", default="UTC")
    parser.add_argument("--email", default=None)
    parser.add_argument("--label", default="default")
    args = parser.parse_args()

    async with SessionLocal() as db:
        user, raw = await create_user(
            db,
            timezone=args.timezone,
            email=args.email,
            label=args.label,
        )
    print(f"user_id={user.id}")
    print(f"timezone={user.timezone}")
    print(f"api_key={raw}")
    print("Store the api_key now; it will not be shown again.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
