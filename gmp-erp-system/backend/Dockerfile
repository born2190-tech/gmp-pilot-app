FROM python:3.12-slim

WORKDIR /app

# fonts-dejavu provides Cyrillic-capable TTF fonts used by the QC notification
# PDF renderer (ReportLab). fonts-liberation adds Liberation Serif — a
# metric-compatible, Cyrillic-capable substitute for Times New Roman, used by
# the аналитический лист (Ф-11). Without them Russian text shows as boxes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu fonts-liberation \
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
    "python-docx>=1.1" \
    "qrcode[pil]>=7.4" \
    "opencv-python-headless>=4.10" \
    "pypdfium2>=4.30" \
    "python-multipart>=0.0.9" \
    "httpx>=0.27"

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
