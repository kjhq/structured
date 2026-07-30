FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
COPY scripts ./scripts
COPY alembic.ini ./
COPY alembic ./alembic

# Pin via pyproject (mcp<2); lockfile keeps reproducible resolves when present.
RUN pip install --no-cache-dir uv \
    && uv pip install --system . \
    && chmod +x /app/scripts/entrypoint.sh

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["/app/scripts/entrypoint.sh"]
