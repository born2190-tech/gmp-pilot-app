# GMP ERP/MES Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a configurable GMP ERP/MES platform for pharmaceutical plants, starting with one pilot plant, solid dosage forms, sterile products, warehouse flows, QC/QA, electronic document management, and full electronic batch record.

**Architecture:** Use a modular monolith for the first production version: one validated product, one transactional database, strict module boundaries. Do not hard-code the pilot plant's "Process 1-6" structure; model it as a configurable site PQS/SMK map over stable GMP system domains.

**Tech Stack:** To be selected after URS/FRS, but the plan assumes a web application with role-based access control, relational database, immutable audit trail, electronic signatures, workflow engine, document storage, reporting, and operator terminals/tablets for shop-floor EBR execution.

---

## 1. Non-Negotiable Architecture Principles

- The system is a full future replacement for ERP/1C operational functions, but finance, accounting, payroll, tax, treasury, and P&L are outside the first release.
- The first release is for one plant, but the platform must support future plants with different SMK/PQS structures.
- "Process" is a site-local term, not a core platform concept. Core platform terms are `PQS element`, `GMP system domain`, `procedure`, `workflow`, `operation`, `record`, `signature`, and `evidence`.
- The pilot plant's current processes are configuration:
  - Process 1 -> PQS / Quality Management
  - Process 2 -> Distribution, warehouse, returns, transport
  - Process 3 -> Procurement and incoming material flow
  - Process 4 -> Production and packaging
  - Process 5 -> Laboratory Control, QC, QA
  - Process 6 -> Facilities, equipment, production environment
- No material movement is allowed without batch/lot identity, quality status, approved document/workflow, responsible role, electronic signature where required, and audit trail.
- No EBR operation is complete without recorded execution data, timestamp, responsible user, applicable SOP/version, and required checks/signatures.
- All GxP-relevant changes require audit trail. Critical actions require electronic signature and reason/comment where applicable.

## 2. Target GMP System Domains

The platform must support these stable domains regardless of how each plant names its SMK:

1. PQS / Quality Management
2. Materials System
3. Production System
4. Packaging and Labeling System
5. Laboratory Control System
6. Facilities and Equipment System
7. Distribution / Dispatch
8. Electronic Document and Records Management
9. Computerized System Validation / Data Integrity

## 3. Release Strategy

### Release 0: Discovery, URS, and Validation Basis

Purpose: convert existing SOP lists and selected full SOPs/forms into requirements.

Deliverables:

- Document register from control lists.
- SOP-to-system matrix template.
- Pilot end-to-end process map:
  - material receipt;
  - quarantine;
  - sampling;
  - QC testing;
  - QA release;
  - issue to production;
  - EBR execution;
  - finished product receipt;
  - QA batch release;
  - dispatch.
- URS for first release.
- Initial validation strategy:
  - GxP impact assessment;
  - high-level risk assessment;
  - traceability matrix structure;
  - IQ/OQ/PQ approach.

Required SOP inputs for pilot analysis:

- Document control and records: `ПСК-1`, `ПСК-2`, `СОП-121`
- Change/deviation/CAPA/risk: `ПСК-5`, `ПСК-6`, `ПСК-8`, `ПСК-10`
- Warehouse and distribution: `СОП-205`, `СОП-209`, `СОП-217`, `СОП-223`, `СОП-230`, `СОП-231`
- Production and BMR/EBR: `СОП-409`, `СОП-414`, `СОП-415`, `СОП-435`, `СОП-442`
- QC/QA: `СОП-512`, `СОП-533`, `СОП-540`, `СОП-548`, `СОП-549`
- Equipment/environment: `ДПСК-603`, `СОП-618`, `СОП-619`, plus SOPs for one pilot production line's key equipment
- One full product route:
  - one solid dosage product SOP and its material norms;
  - one sterile product route when available.

Exit criteria:

- URS approved by business, QA, QC, production, warehouse, engineering, and IT.
- Each pilot SOP requirement is mapped to a module, workflow, record, or explicit out-of-scope item.

### Release 1: GMP Core and Site PQS Configuration

Purpose: build the validated foundation used by every later module.

Functional scope:

- Users, roles, departments, job functions.
- Role-based permissions.
- Electronic signature policy:
  - password re-entry or equivalent authentication;
  - signature meaning;
  - timestamp;
  - record binding.
- Audit trail:
  - create/update/delete/approve/reject/release/block actions;
  - old value/new value;
  - user;
  - timestamp;
  - reason where required.
- Site configuration:
  - plant;
  - local SMK/PQS structure;
  - local process names/numbers;
  - mapping to GMP system domains.
- Document metadata:
  - document code;
  - title;
  - version/revision;
  - effective date;
  - expiry/review date;
  - owner;
  - status.
- Basic workflow engine:
  - draft;
  - review;
  - approve;
  - effective;
  - obsolete;
  - rejected.

Deliverables:

- Configurable PQS/SMK map for the pilot plant.
- Imported register of 413 document lines from the first 6 control lists.
- Role model draft:
  - QA manager;
  - QC analyst;
  - QC manager;
  - warehouse operator;
  - warehouse manager;
  - production operator;
  - shift master;
  - technologist;
  - engineering;
  - document control specialist;
  - system administrator.
- Audit trail report.
- Electronic signature report.

Exit criteria:

- QA can see which local process/procedure belongs to which GMP system domain.
- Any GxP metadata change is traceable.
- Effective document versions are distinguishable from obsolete versions.

### Release 2: Materials and Warehouse System

Purpose: control all incoming and outgoing material movements.

Functional scope:

- Material master:
  - API/substance;
  - excipient;
  - primary packaging;
  - secondary packaging;
  - printed packaging;
  - intermediate;
  - finished product.
- Batch/lot master:
  - supplier lot;
  - internal lot;
  - manufacturing date;
  - expiry/retest date;
  - quality status.
- Warehouse structure:
  - raw material warehouse;
  - packaging material warehouse;
  - quarantine;
  - rejected/blocked;
  - released;
  - finished goods;
  - returns;
  - destruction area.
- Material receipt:
  - receipt document;
  - supplier;
  - purchase/import reference where applicable;
  - quantity;
  - packaging units;
  - initial quarantine status.
- Sampling request to QC.
- Status transitions:
  - received;
  - quarantine;
  - sampled;
  - under test;
  - released;
  - blocked;
  - rejected;
  - expired;
  - returned;
  - destroyed.
- Material issue to production.
- Return from production.
- Write-off, destruction, and blocked stock.
- Temperature/humidity records for warehouse areas, at minimum manual entry in first release.

Deliverables:

- Warehouse transaction ledger.
- Current stock by material, lot, status, location.
- Lot history report.
- FEFO/FIFO picking logic for finished goods and applicable materials.
- Blocked stock report.

Exit criteria:

- Released material can be issued to production.
- Quarantine/blocked/rejected/expired material cannot be issued without authorized override workflow.
- Every stock movement has source document, user, timestamp, and audit trail.

### Release 3: QC / QA / LIMS-Light

Purpose: connect sampling, testing, QC conclusion, and QA release to material and product statuses.

Functional scope:

- Sampling plan and sampling tasks.
- Sample labels and sample chain of custody.
- QC test request.
- Test methods/specification metadata.
- Result entry with limits.
- Result review.
- OOS/OOT/RNS initiation.
- QC conclusion:
  - conforms;
  - does not conform;
  - investigation required.
- QA release decision:
  - release;
  - block;
  - reject;
  - return for investigation.
- COA metadata where applicable.
- Reference/arbitration sample registration.
- Batch dossier checklist for QA review.

Deliverables:

- QC task dashboard.
- QA release dashboard.
- OOS/OOT/RNS workflow.
- Material status update integration.
- Batch release checklist.

Exit criteria:

- Warehouse status changes are driven by QC/QA decisions, not manual stock edits.
- OOS/OOT/RNS blocks release until resolved.
- QA can trace release decision to sample, result, reviewer, and approved specification.

### Release 4: Production Orders / ZPS and Material Reconciliation

Purpose: plan and launch production series with controlled material reservation and issue.

Functional scope:

- Product master.
- Master formula / bill of materials.
- Production route metadata.
- Production order / ZPS:
  - product;
  - strength;
  - batch size;
  - planned quantity;
  - planned line/equipment;
  - planned dates;
  - required materials.
- Material requirement calculation.
- Lot reservation.
- Material issue request to warehouse.
- Material receipt in production area.
- Return of unused material.
- Intermediate and finished product yield.
- Material reconciliation:
  - issued;
  - used;
  - returned;
  - waste;
  - variance;
  - variance approval.

Deliverables:

- ZPS dashboard.
- Material reservation report.
- Issue-to-production workflow.
- Reconciliation report.

Exit criteria:

- A production order cannot start without required released materials or approved exception.
- Material variance outside limits requires deviation or approval workflow.
- Production output links back to all consumed lots.

### Release 5: EBR for Solid Dosage Forms

Purpose: replace paper BMR/BPR execution for pilot solid dosage routes.

Functional scope:

- EBR template builder for solid dosage forms.
- Step types:
  - instruction;
  - material verification;
  - weighing;
  - equipment verification;
  - room/line clearance;
  - process parameter entry;
  - IPC entry;
  - yield calculation;
  - reconciliation;
  - operator signature;
  - supervisor signature;
  - QA/QC checkpoint.
- Solid dosage stages:
  - weighing;
  - sieving/milling where applicable;
  - mixing;
  - granulation where applicable;
  - drying where applicable;
  - calibration;
  - compression or encapsulation;
  - coating where applicable;
  - primary packaging;
  - secondary packaging.
- IPC examples:
  - tablet weight;
  - hardness;
  - friability;
  - disintegration;
  - appearance;
  - blister leak test where applicable.
- Line clearance.
- Batch record review by QA.

Deliverables:

- One pilot tablet/capsule EBR template.
- Operator terminal execution screen.
- In-process control entry screens.
- EBR PDF/export or controlled record view.
- QA batch review workflow.

Exit criteria:

- A pilot solid dosage batch can be executed from ZPS to QA-reviewed EBR.
- Operators cannot skip mandatory steps.
- Out-of-limit IPC triggers hold/deviation workflow.

### Release 6: Packaging and Labeling Control

Purpose: control printed materials, labeling, packaging reconciliation, and finished goods transfer.

Functional scope:

- Printed material version control.
- Packaging order linked to production order.
- Line clearance before packaging.
- Issuance of packaging materials.
- Verification of item code/version.
- Primary packaging execution.
- Secondary packaging execution.
- Reconciliation:
  - issued packaging;
  - used packaging;
  - rejected/damaged;
  - returned;
  - destroyed printed components.
- Finished goods receipt into quarantine.

Deliverables:

- Packaging EBR/BPR workflow.
- Printed material reconciliation report.
- Finished goods transfer workflow.

Exit criteria:

- Finished goods cannot be received without completed packaging reconciliation.
- Printed packaging discrepancies require QA review.

### Release 7: Facilities, Equipment, and Environment

Purpose: ensure production and QC operations use qualified, maintained, and available assets.

Functional scope:

- Equipment/asset master.
- Rooms and clean areas.
- Equipment status:
  - available;
  - in use;
  - cleaning required;
  - under maintenance;
  - calibration due;
  - qualified;
  - blocked.
- Preventive maintenance schedule.
- Calibration/qualification due dates.
- Cleaning/sanitation status.
- Environmental monitoring records:
  - temperature;
  - humidity;
  - differential pressure;
  - viable/non-viable monitoring where applicable.
- Utility systems:
  - water;
  - HVAC;
  - compressed air.
- Equipment availability check in EBR.

Deliverables:

- Asset register.
- Maintenance calendar.
- Calibration/qualification due report.
- Equipment status integration with EBR.
- Environmental condition record.

Exit criteria:

- EBR cannot use blocked or overdue critical equipment without authorized deviation.
- Environmental condition excursions trigger investigation or hold workflow where required.

### Release 8: Sterile Production EBR

Purpose: extend EBR and environment controls to sterile products.

Functional scope:

- Sterile product route templates:
  - solution preparation;
  - filtration;
  - sterilization where applicable;
  - aseptic filling;
  - stoppering/capping;
  - visual inspection;
  - labeling;
  - packaging.
- Sterile-specific checks:
  - cleanroom status;
  - line clearance;
  - sterilization cycle reference;
  - filter integrity test;
  - hold time;
  - bioburden;
  - endotoxin;
  - sterility;
  - environmental monitoring;
  - media fill link where applicable.
- Hard QA blocks for incomplete sterility/endotoxin/EM requirements.

Deliverables:

- One sterile product EBR template.
- Sterile batch release checklist.
- EM linkage to batch.
- Filter integrity / sterilization record references.

Exit criteria:

- A pilot sterile batch cannot be released until all critical sterile controls are completed and reviewed.
- Any critical sterile excursion blocks batch release pending QA decision.

### Release 9: Electronic Document Management and Training

Purpose: manage SOPs, forms, versions, effective dates, and required training.

Functional scope:

- Document lifecycle:
  - draft;
  - review;
  - approved;
  - effective;
  - superseded;
  - obsolete.
- Version control.
- Effective date control.
- Document distribution.
- Read-and-understood training.
- Training matrix by role.
- Forms/templates linked to workflows and EBR steps.
- Archive and retrieval.

Deliverables:

- Document repository.
- Approval workflow.
- Training assignments.
- Training completion evidence.
- Obsolete document prevention in active workflows.

Exit criteria:

- Only effective SOP/form versions can be used in new workflows.
- Users cannot perform configured critical tasks if required training is incomplete, unless an approved override exists.

### Release 10: Dispatch, Returns, Complaints, Recall, and Traceability

Purpose: complete finished product movement and post-distribution quality controls.

Functional scope:

- Finished goods release to saleable stock.
- Sales/dispatch order without finance.
- Picking by FEFO/FIFO and QA status.
- Shipment documentation.
- Transport condition record.
- Customer/distributor master.
- Returns workflow.
- Complaint registration.
- Recall workflow.
- Full traceability:
  - customer/distributor -> finished batch -> packaging lots -> production batch -> raw material lots -> supplier lots.

Deliverables:

- Dispatch workflow.
- Return workflow.
- Complaint/recall workflow.
- Traceability report.

Exit criteria:

- Only QA-released finished goods can be dispatched.
- Recall simulation can identify affected customers and upstream material lots.

## 4. Cross-Cutting Validation and Compliance Workstream

This workstream runs across all releases.

Required artifacts:

- URS
- FRS
- configuration specification
- risk assessment
- data integrity assessment
- audit trail assessment
- electronic signature assessment
- traceability matrix
- IQ protocol/report
- OQ protocol/report
- PQ protocol/report
- SOPs for system use and administration
- backup/restore procedure
- access management procedure
- change control procedure for the computerized system
- periodic review procedure

Minimum validation expectations:

- Every URS requirement maps to at least one FRS item.
- Every FRS item maps to test evidence or justified non-testing evidence.
- Every critical GMP workflow has positive and negative tests.
- Every electronic signature scenario proves signature meaning, user identity, timestamp, and record binding.
- Every audit trail scenario proves old value/new value, user, timestamp, and reason where required.

## 5. Data Model Foundation

Core objects required before detailed development:

- Plant
- Site PQS/SMK element
- GMP system domain
- Department
- Role
- User
- Permission
- Electronic signature event
- Audit trail event
- Document
- Document version
- SOP
- Form/template
- Workflow definition
- Workflow instance
- Material
- Material type
- Batch/lot
- Warehouse
- Location
- Stock balance
- Stock transaction
- Sample
- Test request
- Test result
- Specification
- OOS/OOT/RNS record
- QA release decision
- Product
- Master formula
- Production route
- Production order/ZPS
- EBR template
- EBR execution
- EBR step
- Equipment/asset
- Room/area
- Maintenance event
- Calibration/qualification event
- Environmental monitoring record
- Finished goods shipment
- Return
- Complaint
- Recall

## 6. First Build Recommendation

Do not start coding with all modules at once.

Build first vertical slice:

`GMP Core -> Material Receipt -> Quarantine -> Sampling -> QC Result -> QA Release -> Issue to Production -> One Solid Dosage EBR -> Finished Goods Quarantine`

This slice proves the hardest parts:

- configurable PQS/SMK;
- batch/lot control;
- quality status control;
- audit trail;
- electronic signatures;
- workflow;
- material movement;
- QC/QA release;
- operator EBR execution.

## 7. Immediate Next Tasks

- [ ] Collect full text of pilot SOPs listed in Release 0.
- [ ] Choose one solid dosage product as pilot EBR route.
- [ ] Identify whether one sterile product route is ready for analysis now or should start after solid dosage EBR.
- [ ] Create SOP-to-system matrix for the pilot flow.
- [ ] Draft URS v0.1 from the matrix.
- [ ] Review URS with QA, QC, production, warehouse, engineering, and IT.
- [ ] Freeze Release 1 and vertical slice scope.
- [ ] Select technology stack and implementation team model.

## 8. Self-Review

Spec coverage:

- Full future ERP replacement covered as target direction.
- Finance exclusion covered.
- One-plant pilot covered.
- Future multi-site configurability covered through Site PQS/SMK model.
- Solid dosage EBR covered.
- Sterile EBR covered.
- Warehouse, QC/QA, document management, equipment/environment, dispatch covered.
- GMP validation and data integrity covered.

Placeholder scan:

- No TBD/TODO placeholders.
- Open choices are intentionally listed as immediate next tasks because they require user/company decisions.

Type consistency:

- The plan consistently uses `PQS/SMK element`, `GMP system domain`, `workflow`, `record`, `EBR`, `ZPS`, `batch/lot`, and `QA release`.
