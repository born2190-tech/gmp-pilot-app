# GMP ERP Foundation UX/Product Design

## Goal

Build a production-oriented, configurable GMP ERP/WMS/QC/QA platform for pharmaceutical plants. The first production-ready flow is receipt of materials through QA release and issue to production, while the architecture leaves room for production, electronic BMR/ZPS, document control, reports, and mobile warehouse workflows.

## Product Positioning

This is not a demo dashboard. The system is an operational record system with GMP controls:

- role-based and scope-based access;
- immutable audit trail;
- electronic signatures for critical actions;
- document-style warehouse accounting;
- lot and series traceability;
- QC/QA workflow blocking rules;
- configurable master data for different plants.

## Technology Direction

Backend:

- FastAPI;
- PostgreSQL as runtime database;
- SQLAlchemy 2.x;
- Alembic migrations;
- Pydantic schemas;
- JWT or opaque session tokens;
- RBAC and scope authorization;
- audit and e-signature as shared platform services.

Frontend:

- React;
- TypeScript;
- Vite;
- Tailwind;
- shadcn/ui;
- TanStack Table;
- TanStack Query;
- React Hook Form;
- Zod;
- lucide-react.

## Roles and Departments

Core platform roles:

- WAREHOUSE_OPERATOR;
- WAREHOUSE_MANAGER;
- QC_ANALYST;
- QA_MANAGER;
- PRODUCTION_OPERATOR;
- SHIFT_MASTER;
- TECHNOLOGIST;
- SYS_ADMIN.

Department approval roles:

- HEAD_QA, for Head of Quality Assurance / Начальник ООК;
- HEAD_QC, for Head of Quality Control / Начальник ОКК;
- HEAD_PRODUCTION, for Начальник производства;
- WORKSHOP_HEAD, for Начальник цеха;
- CHIEF_TECHNOLOGIST, for Главный технолог.

Each approval role can approve only actions belonging to its department scope unless SYS_ADMIN assigns explicit cross-functional permissions.

Warehouse users also have a warehouse scope:

- SUBSTANCE_WAREHOUSE;
- PACKAGING_WAREHOUSE;
- FG_WAREHOUSE.

Warehouse users see only their assigned warehouse data. QC, QA, production, and system users see data according to process permissions, not blanket access.

## Main Navigation

After login, the sidebar is generated from permissions. Users must see only the sections they can use.

Common shell:

- top search by lot, material, supplier lot, document number, barcode, or QR;
- current user, department, role, warehouse scope, workstation ID;
- notifications;
- logout.

Potential sections:

- Dashboard;
- Warehouse;
- Receipt Documents;
- Lots / Series;
- Inventory Balances;
- Movements;
- Finished Goods Traceability;
- QC;
- QA;
- Production;
- BMR / ZPS;
- Documents;
- Master Data;
- Reports;
- Audit Trail;
- Administration.

Example visibility:

- Warehouse users: Warehouse dashboard, Receipt Documents, Lots / Series, Balances, Movements, Adjustments, Rejected / Expired, Issue to Production.
- FG warehouse users: finished goods lots, FG stock, shipment documents, shipment history, customer/recipient traceability, returns.
- QC users: QC Dashboard, Sampling Tasks, QC Reports, OOS/OOT, Specifications, QC history.
- QA users: QA Dashboard, QA Decisions, Deviations, Release Review, Audit Trail, effective documents.
- Production users: Production Orders, Material Issue, BMR / ZPS Execution, Finished Goods Receipt.
- SYS_ADMIN: users, roles, permissions, master data, workflow settings, security logs.

## Core Workflow

The first implemented workflow is:

1. Receipt document is drafted.
2. Receipt is posted with e-signature.
3. System creates internal lot/series and inventory movement RECEIPT.
4. Lot enters received or quarantine status according to configured plant policy.
5. Warehouse sends incoming control notification to QC.
6. QC creates or accepts sampling task.
7. QC records sampling and analysis results.
8. If any result is out of specification, system creates OOS/deviation and blocks QA release.
9. QA reviews lot, QC report, documents, deviations, audit, and decides release, block, reject, or request more info.
10. Released lots become eligible for issue to production using FEFO/FIFO guidance.

## Lot and Product Data

Every lot or product series must support:

- material or product code;
- material or product name;
- item type: raw material, packaging material, intermediate, bulk, finished good;
- supplier;
- manufacturer;
- supplier lot;
- internal lot or internal series;
- production date;
- production year;
- expiry date;
- received date;
- warehouse;
- location/bin;
- quantity;
- unit;
- quality status;
- incoming_control_notified_at;
- sampling_date;
- qc_result_received_at;
- qa_decision_at;
- released_by, blocked_by, or rejected_by;
- supplier documents;
- certificate of analysis;
- QC reports;
- deviations and OOS/OOT cases;
- warehouse movements;
- audit events;
- signature events.

## Finished Goods Traceability

The FG warehouse must provide full downstream traceability for every finished product series.

Core workflow:

1. Finished goods receipt creates or increases an FG lot.
2. QA release makes the FG lot eligible for sale or shipment.
3. Shipment document records recipient/customer, shipment date, transport details, responsible employee, document number, and shipped quantities.
4. Each shipment line links one FG lot or series to a recipient.
5. Return or recall records link back to the original shipment line.

Required data:

- FG product code and name;
- internal FG series;
- manufacturing date;
- expiry date;
- QA release status;
- stock quantity before and after shipment;
- shipment document number;
- shipment date;
- recipient/customer/distributor;
- destination;
- shipped quantity and unit;
- transport or vehicle reference;
- responsible warehouse employee;
- approved by, if configured;
- return quantity and reason, if applicable;
- recall flag, if applicable;
- audit events and signature events.

Required filters:

- product;
- internal series;
- expiry date range;
- shipment date range;
- recipient/customer;
- shipment document number;
- QA status;
- returned or recalled;
- "show all recipients for this series".

The system must answer quickly: which recipients received a given finished goods series, when, in what quantity, and under which shipment document.

## Statuses

Initial quality statuses:

- received;
- quarantine;
- sampled;
- under_test;
- released;
- blocked;
- rejected;
- expired.

Status changes are controlled by a state machine. Each transition defines:

- allowed source statuses;
- allowed destination statuses;
- required permission;
- whether reason is required;
- whether e-signature is required;
- whether a department head approval is required;
- audit event contents.

## Key Screens

### Login

Purpose:

- authenticate user;
- capture workstation identity;
- load role, department, permissions, and scopes.

Required fields:

- username;
- password;
- workstation ID.

States:

- loading;
- invalid credentials;
- locked user;
- password expired;
- missing workstation ID;
- success.

### Department Dashboard

Dashboard content depends on role:

- warehouse: lots requiring action, quarantine, released stock, expired soon, recent movements;
- QC: open sampling tasks, overdue tasks, OOS/OOT, pending reports;
- QA: lots awaiting decision, open deviations, blocked releases, pending approvals;
- production: production orders, material shortages, BMR steps awaiting action;
- admin: user/security/system health.

### Receipt Document

Required fields:

- supplier;
- manufacturer;
- material_code;
- material_name;
- supplier_lot;
- production_date or production_year;
- expiry_date;
- quantity;
- unit;
- warehouse;
- location;
- received_date;
- attached supplier documents.

Rules:

- posting requires e-signature;
- posted documents are immutable;
- corrections are separate documents;
- posting creates a lot and a RECEIPT movement;
- system records who posted, when, from which workstation, and why.

### Lots / Series Board

Core columns:

- internal lot/series;
- material/product code;
- material/product name;
- supplier;
- manufacturer;
- supplier lot;
- warehouse;
- location;
- quantity;
- unit;
- quality status;
- production date/year;
- expiry date;
- incoming control notified date;
- sampling date;
- QC result received date;
- QA decision date;
- open deviation flag;
- last action;
- available actions.

Rules:

- unavailable actions still explain why they are blocked;
- warehouse users see only their warehouse scope;
- expired lots are flagged and moved into review/blocking workflow;
- released lots show production issue eligibility.

### Warehouse Movements

Movement types:

- receipt;
- issue_to_production;
- transfer;
- adjustment;
- return;
- reject;
- destruction;
- finished_goods_receipt.

Finished goods shipment and returns are also represented as inventory movements, but the customer-facing traceability comes from shipment documents and shipment lines, not from movements alone.

Rules:

- movements are immutable;
- inventory is reconstructed from movements plus current stock snapshots;
- corrections are reverse or adjustment movements;
- critical movements require reason and e-signature.

### QC Task Board and QC Report

QC task statuses:

- open;
- sampled;
- in_analysis;
- completed;
- cancelled.

QC report parameter fields:

- parameter name;
- method;
- unit;
- lower limit;
- upper limit;
- result;
- pass/fail;
- instrument;
- analyst.

Rules:

- QC cannot edit warehouse receipt data;
- QC report submit requires e-signature;
- submitted reports are immutable;
- correction uses amendment workflow;
- OOS/OOT creates a deviation and blocks QA release.

### QA Decision

Decisions:

- release;
- block;
- reject;
- request more info.

Rules:

- release is blocked without completed QC report;
- release is blocked with open OOS/deviation;
- block, reject, and request more info require reason;
- final QA decision requires QA role or Head QA approval depending on workflow configuration;
- decision is recorded in audit and signature logs.

### E-signature Modal

Fields:

- username;
- password;
- meaning;
- reason/comment;
- confirmation checkbox.

Rules:

- signer must match current user unless second approval is configured;
- failed signature attempts are recorded;
- signatures are linked to action, object, old value, new value, timestamp, role, and workstation.

## UX Rules

- Show only sections and actions allowed by permissions.
- Never rely only on hidden buttons; blocked actions should show a reason when the user can see the object but cannot act.
- Use dense, readable tables with filters and saved views.
- Require explicit reason for risky state changes.
- Critical actions use confirmation plus e-signature.
- Every object page includes timeline, documents, movements, signatures, and changes.
- Operator forms minimize free text and prefer configured dictionaries.
- Dates and expiry warnings are visible in all lot tables.
- FEFO/FIFO suggestions are shown at issue-to-production time.
- Documents already posted or approved are immutable.

## MVP Design System

Tokens:

- background: #F7F8FA;
- surface: #FFFFFF;
- border: #D9DEE7;
- text: #111827;
- muted: #6B7280;
- primary: #1D4ED8;
- success: #15803D;
- warning: #B45309;
- danger: #B91C1C;
- blocked: #374151.

Typography:

- font: Inter or system UI;
- table text: 13px;
- form label: 13px;
- body: 14px;
- section title: 16px;
- page title: 20px.

Core components:

- AppShell;
- RoleAwareSidebar;
- Topbar;
- PermissionGate;
- DataTable;
- FilterBar;
- StatusBadge;
- DocumentForm;
- LotSummaryPanel;
- AuditTimeline;
- ESignatureModal;
- QCParameterTable;
- QAReviewPanel;
- EmptyState;
- ErrorBanner;
- ConfirmActionDialog.

## Phase 1 Scope

Phase 1 implements:

- project foundation;
- PostgreSQL runtime;
- Alembic migrations;
- users, roles, departments, permissions, warehouse scopes;
- login and current user;
- role-aware frontend shell;
- master data for warehouses, suppliers, manufacturers, materials, employees;
- receipt document;
- lot/series registry;
- inventory movements;
- audit trail;
- e-signature;
- first warehouse dashboard.

QC, QA, production, BMR/ZPS, document control, reports, QR/barcodes, and mobile warehouse are designed now but implemented in later phases.

Finished goods shipment traceability is designed now and must be implemented as a dedicated module after the first warehouse foundation screens. It should not be reduced to a generic stock movement table because recipient-level traceability is required.
