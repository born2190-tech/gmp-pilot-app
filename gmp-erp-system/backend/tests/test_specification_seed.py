from app.core.database import SessionLocal
from app.models.inventory import Lot
from app.models.master_data import Material
from app.models.quality import MaterialSpecification, SpecificationParameter
from app.services.seed import seed_foundation_data
from app.services.specifications import resolve_for_lot


def test_seed_links_novusita_raw_material_specifications_to_materials() -> None:
    db = SessionLocal()
    try:
        seed_foundation_data(db)

        expected = {
            "API-MET": "НД-SPC/СУБ/039/23",
            "EXC-SLS": "НД-SPC/СУБ/008/23",
            "EXC-SOD": "SPC/СУБ/007/23",
            "EXC-MGST": "НД-SPC/Суб/003/23",
            "EXC-MCC": "НД-SPC/СУБ/009/23",
            "EXC-LACTOSE": "SPC/СУБ/006/23",
            "EXC-CROSPOV": "НД-SPC/СУБ/030/23",
            "EXC-AEROSIL": "НД-SPC/СУБ/012/23",
            "EXC-OPA-BLUE": "НД-SPC/СУБ/010/23",
        }

        for material_code, nd_code in expected.items():
            material = db.query(Material).filter(Material.code == material_code).one()
            spec = db.query(MaterialSpecification).filter(MaterialSpecification.nd_code == nd_code).one()

            assert spec.material_id == material.id
            assert spec.is_active is True
            assert spec.sop_form == "533"
            assert db.query(SpecificationParameter).filter(
                SpecificationParameter.specification_id == spec.id
            ).count() >= 5

            lot = Lot(material_id=material.id)
            assert resolve_for_lot(db, lot).id == spec.id
    finally:
        db.close()
