#!/bin/sh
set -e
# Prefer Alembic migrations. Stamp 0001 then upgrade when alembic_version is empty
# on a legacy create_all database (see docs in README).
alembic upgrade head
exec uvicorn structured_backend.main:app --host 0.0.0.0 --port 8000
