# Historical Data Requirement — IFL SMS

## Recommended request

### Minimum for normal production-system development/validation
**3 months** of clean historical data.

### Recommended for production accuracy and trend validation
**6 months**.

### Preferred
**12 months**.

### For a genuine AI/ML calibration model
**12 months is preferred**, and the data must contain more than just weight readings.

## What we need

### Cone data
Preferably every cone record with:
- production timestamp
- database timestamp
- machine ID
- station/spindle ID
- cone ID if available
- product/material ID
- target weight
- actual weight
- pass/reject status
- reject code/reason

### Sack data
Preferably every sack record with:
- timestamp
- sack ID
- machine ID
- product
- weight
- lot/pallet if available
- sack type

### Product history
We need to know:
- when a product started
- when it stopped
- target weight
- WT+
- WT-
- product code/material ID

### Calibration history
This is especially important for AI:
- machine/station
- date/time
- product
- measured problem
- adjustment made
- setting before
- setting after
- result after adjustment

## Why 6–12 months?

The purpose is not simply to have a large number of rows.

We need enough history to cover:
- different products
- different shifts
- different machines
- normal production
- abnormal production
- rejects
- calibration events
- product changes
- maintenance periods
- seasonal/long-term drift

A very large dataset with no machine ID, product ID or calibration labels may be less useful than a smaller but well-structured dataset.

## AI-specific warning

If IFL wants genuine AI/ML calibration recommendations, historical data alone is not enough.

We need examples of:
1. machine/product condition,
2. measured weight behaviour,
3. actual calibration action,
4. result after calibration.

Without those labels/events, an AI model can detect patterns/anomalies, but it cannot reliably learn "what calibration adjustment should be made."

## Data format

Best:
- SQL Server backup or read-only database access.

Also acceptable:
- CSV/Excel exports.

Preferred export structure:
- one file/table for cone readings
- one for rejects
- one for product master/history
- one for sacks
- one for calibration/adjustment history

Keep the original IDs and timestamps. Do not aggregate the data before giving it to QTech.
