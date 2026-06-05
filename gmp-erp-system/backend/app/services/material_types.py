"""Единый, регистронезависимый детектор «упаковочного» вида материала.

Вокабуляр item_type в системе исторически разнится (seed: raw_material;
форма мастер-данных: PACKAGING/SUBSTANCE; маршрутизация: packaging/label/
container). Чтобы маршрутизация требований, разбивка PDF и админ-гейт типа
упаковки вели себя одинаково — используем эту функцию вместо точных сравнений.
"""
from __future__ import annotations

# Канонические значения упаковочного вида материала (нижний регистр).
PACKAGING_ITEM_TYPES = {"packaging", "label", "container"}


def is_packaging_item_type(item_type: str | None) -> bool:
    t = (item_type or "").strip().lower()
    if not t:
        return False
    return t in PACKAGING_ITEM_TYPES or t.startswith("packag")
