# IFL Sack Management System — Development Roadmap for Claude Code

## Purpose

Convert the existing independently developed SMS software into a production-ready, configurable IFL Sack Management System.

Important:
- The existing SMS was developed independently as a prototype/reference.
- It must NOT be represented as an IFL-commissioned or IFL-approved system.
- Preserve the existing working functionality where sound.
- Do not rewrite the application from scratch.
- Do not add speculative features before the corresponding IFL requirement is confirmed.

## Target Scope

Initial deployment basis:
- IFL TP1 Unit 2 Line #3
- 14 Rieter cone-winding machines
- Existing cone PLC/data acquisition
- Existing PDAS database
- Neuenhauser sack-packing system
- Existing sack PLC/data acquisition
- Existing Sack Packing database

Core functions:
1. Cone data acquisition and monitoring
2. Cone weight limit checking
3. Reject monitoring/history/trends
4. Product management and product attribution
5. Sack data acquisition/history
6. Sack stock management, subject to machine-ID availability
7. Dashboards and reports
8. Statistical calibration advisory
9. Optional AI/ML calibration module
10. User/RBAC/security/audit
11. Historical data retention
12. Integration health monitoring
13. Backup/restore
14. Scalable line/machine configuration

---

# Phase 0 — Freeze and Baseline Existing SMS

## Goal
Create a clean, reproducible starting point before major changes.

### Tasks
- Review current Git working tree.
- Identify all uncommitted changes.
- Separate:
  - completed features
  - experimental work
  - obsolete code
  - known defects
- Run the complete existing test suite.
- Record current test count and failures.
- Verify all database migrations apply cleanly.
- Create a clean baseline release/tag.
- Document current environment variables and secrets without committing secrets.
- Confirm current database backup/restore procedure.
- Create a `BASELINE.md` describing what works today.

### Acceptance
- Clean Git baseline.
- Existing tests pass or known failures are documented.
- Application starts from a clean checkout.
- Database can be created/restored from documented steps.
- No production credentials are stored in source control.

---

# Phase 1 — Convert SMS from IFL-specific Prototype to Configurable Platform

## Goal
Remove unnecessary hard-coding around TP1 U2 Line #3.

### Tasks
Introduce/verify configuration entities for:
- Plant
- Unit
- Line
- Machine
- Station
- Data source
- Product
- Product limit
- Reject code
- Shift

Avoid hard-coded:
- line numbers
- machine numbers
- product codes
- reject codes
- database names
- IP addresses
- source-generation identifiers

Move operational settings into configuration where appropriate.

### Acceptance
- Current TP1 U2 Line #3 continues to work using configuration.
- Adding a second machine does not require source-code modification.
- Configuration changes are audited where they affect production calculations.

---

# Phase 2 — Formalize the Integration Layer

## Goal
Create a clean boundary between IFL source systems and SMS.

### Required adapters

### A. SQL/Data Adapter
Primary integration for:
- DATA_TP1U2
- PDAS_TP1U2
- Sack Packing database

Capabilities:
- connection health
- incremental synchronization
- duplicate protection
- source-generation/epoch detection
- source reset handling
- retry/recovery
- lag measurement
- reconciliation
- structured logging

### B. PLC/OPC Adapter
Do NOT build until IFL confirms it is required.

If required:
- identify PLC make/model
- protocol
- read-only tags
- communication method
- driver/licence requirements

Implement adapter behind a common interface so PLC integration does not contaminate the rest of the application.

### Acceptance
- Integration failure does not crash the main application.
- Source data can be reconciled against SMS records.
- Source reset/rebuild cannot silently stop synchronization.
- Integration lag is visible.
- No uncontrolled writes are made to plant systems.

---

# Phase 3 — Canonical Production Data Model

## Goal
Create one consistent internal representation of cone, sack, product and reject events.

### Tasks
Define canonical records for:
- ConeReading
- SackReading
- RejectEvent
- Product
- ProductLimit
- Machine
- Station
- Shift
- CalibrationAdjustment
- DataQualityEvent
- AuditEvent

Each production record should preserve:
- source system
- source table
- source record/key
- source timestamp
- production timestamp where available
- ingestion timestamp
- source generation
- transformation/version
- product attribution status

### Acceptance
Every reportable production record can be traced back to its source.

---

# Phase 4 — Cone Weight Module

## Goal
Make cone monitoring production-grade.

### Tasks
- Read all available cone-weight records.
- Implement active/product-specific limits.
- Distinguish:
  - within limit
  - low
  - high
  - rejected
  - unknown/insufficient data
- Provide machine/station filtering.
- Preserve historical records.
- Validate shift attribution.
- Handle missing/faulty readings according to IFL-confirmed rules.
- Add product-limit administration screen.

### Acceptance
For an agreed sample period:
- SMS cone count reconciles with source.
- Weight totals/statistics reconcile.
- Out-of-limit classification matches approved test cases.

---

# Phase 5 — Reject Management

## Goal
Provide complete reject analysis.

### Tasks
- Import reject records.
- Create IFL-approved reject-code dictionary.
- Show reject count/rate.
- Show reject trends.
- Add drilldown by:
  - date
  - shift
  - product
  - machine/station
  - reject code
- Add daily/code drilldown.
- Keep source and calculated classifications separate.

### Acceptance
IFL can select a period and trace the displayed reject numbers back to source data.

---

# Phase 6 — Product Management / PDAS Integration

## Goal
Provide controlled product selection and, if authorized, PDAS master-data synchronization.

### Tasks
- Maintain product master.
- Support active-product selection.
- Maintain:
  - blend
  - count
  - tube type
  - material
  - target weight
  - WT+
  - WT-
  - active status
  - description fields
- Map product to production data.
- Use documented PDAS stored procedures where applicable.
- Keep write-back disabled until:
  1. IFL gives written authorization
  2. credentials are supplied
  3. live test window is approved
- Audit every write operation.

### Acceptance
- Read path works against approved live/copy data.
- Write path passes offline tests.
- Live write-back is not enabled without authorization.

---

# Phase 7 — Sack Management and Stock Ledger

## Goal
Complete sack functionality without inventing machine relationships.

### Tasks
- Import sack records.
- Define sack timestamp semantics with IFL.
- Define gross/net/tare basis.
- Define sack identity.
- Add sack history.
- Add sack count and weight KPIs.
- Build stock ledger:
  - opening balance
  - receipt
  - issue
  - consumption
  - adjustment
  - closing balance
  - machine
  - user
  - timestamp
- Only enable machine-level stock if reliable machine/station identification exists.
- If machine ID is unavailable, implement a controlled manual association workflow or explicitly mark the feature as dependent.

### Acceptance
No sack is attributed to a machine unless the source or approved manual workflow provides a defensible association.

---

# Phase 8 — Dashboards and Reports

## Goal
Deliver the management and operator experience defined by IFL.

### Screens
- Line overview
- Live production
- Cone readings
- Weight analysis
- Rejects
- Sack management
- Product setup
- Reports
- Wall/dashboard
- System health
- User administration

### Reports
- Daily
- Shift
- Product
- Machine/station
- Reject
- Cone weight
- Sack
- Calibration
- Management summary

### Acceptance
IFL approves report layouts and KPI definitions before final freeze.

---

# Phase 9 — Calibration Analytics

## Goal
Provide safe, explainable engineering advice.

### Base method
Retain the existing statistical/rule-based engine.

Include:
- mean/median weight
- standard deviation
- drift
- trend
- station behaviour
- Nelson-style rules where approved
- recommended adjustment
- adjustment history

### Important
Do NOT call this "AI" unless IFL accepts statistical analytics as satisfying the RFQ or an actual ML module is added.

---

# Phase 10 — Optional AI/ML Module

## Start only after data/requirement confirmation.

### Required before development
- At least 6 months of good historical data; 12 months preferred.
- Machine/station identity.
- Product identity.
- Weight readings.
- Actual reject outcome.
- Calibration/adjustment history.
- Before/after weight performance.
- Clear definition of what the model should predict.

### Possible model objectives
- Predict probability of out-of-limit production.
- Detect abnormal drift.
- Recommend when calibration is required.
- Estimate adjustment direction/magnitude.

### Safety rule
AI produces an advisory, not an automatic machine command.

### Acceptance
Model performance must be agreed with IFL before being represented as a contractual AI deliverable.

---

# Phase 11 — Security, Reliability and Operations

### Tasks
- RBAC finalization.
- IFL role mapping.
- Password/session policies.
- Audit trail.
- Service health.
- Data acquisition health.
- Database health.
- Backup schedule.
- Restore test.
- Log rotation.
- Error recovery.
- Application restart recovery.
- Database maintenance.
- Configuration backup.
- Installation/upgrade procedure.

### Acceptance
System can recover from:
- application restart
- service restart
- database restart
- temporary network interruption
- source database interruption

without silent data loss.

---

# Phase 12 — Testing and Release

## Test levels

### Unit tests
Business rules and calculations.

### Integration tests
Source database → integration layer → historian → application.

### Data reconciliation tests
Compare source totals to SMS totals.

### UI tests
Critical workflows.

### Failure tests
- network loss
- source DB unavailable
- duplicate data
- source reset
- missing product
- missing machine
- invalid timestamps

### Security tests
- unauthorized access
- role escalation
- audit integrity

### Performance tests
- expected production rate
- historical report queries
- concurrent users
- synchronization load

### Acceptance
Create a formal FAT/SAT checklist before deployment.

---

# Phase 13 — Documentation

Deliver:
- System architecture
- Database architecture
- Integration specification
- Data dictionary
- User manual
- Administrator manual
- Backup/restore manual
- Installation manual
- Troubleshooting guide
- FAT protocol
- SAT protocol
- Change-control procedure
- Release notes

---

# Phase 14 — Site Commissioning

This is intentionally outside the Claude Code development roadmap.

After software release:
- install server
- configure network
- connect live sources
- validate live data
- perform SAT
- train users
- hand over

---

# Claude Code Rules

1. Never rewrite working modules without a demonstrated reason.
2. Read existing code before changing architecture.
3. Preserve existing tests.
4. Add tests before/with major logic changes.
5. Never fabricate source fields.
6. Never infer machine/sack relationships from timestamps unless IFL explicitly approves the method.
7. Never enable PDAS writes automatically.
8. Never claim AI when the implementation is statistical.
9. Never expose credentials/secrets.
10. Every database schema change requires a migration.
11. Every production calculation must be traceable to source data.
12. Do not silently change historical calculations; version transformations/business rules.
13. Keep source adapters independent from UI/business logic.
14. Before marking a phase complete, update documentation and tests.
15. Keep a `PROJECT_STATUS.md` with:
   - completed
   - in progress
   - blocked
   - IFL dependency
   - test status
16. At the end of each major phase, create a Git commit with a meaningful message.
17. Do not proceed past an IFL dependency by guessing. Mark the dependency and continue with unrelated work.

---

# Definition of Done for Final Product

The final system is ready for IFL FAT when:

- All agreed source integrations work.
- Cone data reconciles.
- Sack data reconciles.
- Product attribution is defined and traceable.
- Reject codes are approved.
- Product limits are approved.
- Reports are approved.
- User roles are approved.
- Sack stock method is approved.
- Calibration advisory is validated.
- AI/ML is either accepted as an optional module or implemented against agreed criteria.
- Backup/restore is tested.
- Failure recovery is tested.
- Security is tested.
- No critical/high unresolved defects remain.
- Installation and FAT documentation is complete.
