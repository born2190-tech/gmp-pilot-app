"""bmr instance: назначения операторов по этапам

Revision ID: 20260531_0037
Revises: 20260530_0036
Create Date: 2026-05-31

Назначения начальника цеха: { stage_code -> [operator_user_id,...] }. Используются
гейтом подписи ДП (оператор должен быть назначен на этап).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260531_0037"
down_revision = "20260530_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bmr_instances",
        sa.Column("assignments", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("bmr_instances", "assignments")
