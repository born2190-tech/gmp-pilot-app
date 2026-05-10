# Pilot Material-to-EBR Readiness Report

Source folder: `D:\01_Pilot_Material_to_EBR`

## File Inventory

Total files: 35

| Format | Count |
|---|---:|
| `.doc` | 23 |
| `.docx` | 11 |
| `.pdf` | 1 |

Inventory file: `pilot_file_inventory.csv`

Extracted UTF-8 text folder: `pilot_extracted_utf8`

## Folder Coverage

| Folder | Status |
|---|---|
| `01_Document_Control` | Present |
| `02_Quality_Systems` | Present |
| `03_Warehouse` | Present |
| `04_Production` | Present |
| `05_QC_QA` | Present |
| `06_Equipment_Environment` | Present |
| `07_Personnel` | Present |

## Important Notes

- All 34 Word files were converted to readable UTF-8 text.
- `СОП-209.pdf` had no embedded text layer, but Microsoft Word converted it to extractable text. The OCR quality is usable for analysis but contains recognition errors, so critical clauses should be checked against the original PDF when finalizing URS.
- `СОП-435` was requested earlier for BMR preparation/issue/control, but the pilot folder contains `СОП_436.doc` instead. This needs confirmation.
- The production folder includes `СОП_461.doc`, which appears to be a technological process for a solid dosage product route and can be used as the pilot EBR route candidate.

## Recommended Analysis Order

1. `ПСК-1`, `ПСК-2`, `СОП-121` for document/record rules.
2. `ПСК-10`, `ПСК-5`, `ПСК-8`, `ПСК-6` for deviations, CAPA, change control, risk.
3. Warehouse SOPs: `СОП-205`, `СОП-209`, `СОП-217`, `СОП-223`, `СОП-231`.
4. Production SOPs: `СОП-409`, `СОП-414`, `СОП-415`, `СОП-442`, `СОП-461`, and `СОП-436` if confirmed.
5. QC/QA SOPs: `СОП-512`, `SOP-533`, `СОП-540`, `СОП-548`, `СОП-549`.
6. Equipment/environment: `ДПСК-607`, `ДПСК-619`, `СОП-618`.
7. Personnel: `П-7`, training plan, `ДПСК-742`, and job descriptions for warehouse, production, QC, QA, and technologist roles.

## Next Output

The next useful deliverable is the pilot SOP-to-system matrix:

`SOP clause -> system requirement -> module -> role -> data/record -> status/blocking rule -> electronic signature -> audit trail -> validation test`
