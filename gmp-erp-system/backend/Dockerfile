FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi>=0.115 \
    "uvicorn[standard]>=0.30" \
    "pydantic>=2.9" \
    "pydantic-settings>=2.6" \
    "SQLAlchemy>=2.0" \
    "alembic>=1.13" \
    "psycopg[binary]>=3.2" \
    "passlib[bcrypt]>=1.7" \
    "python-jose[cryptography]>=3.3" \
    "httpx>=0.27"

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
