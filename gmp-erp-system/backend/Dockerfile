FROM python:3.12-slim

WORKDIR /app

# fonts-dejavu provides Cyrillic-capable TTF fonts used by the QC notification
# PDF renderer (ReportLab). Without them the printed Извещение would show
# Russian text as empty boxes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

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
    "reportlab>=4.2" \
    "httpx>=0.27"

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
