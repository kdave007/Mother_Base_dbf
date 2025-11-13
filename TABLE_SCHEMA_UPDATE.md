# _OPERATIONS Table Schema Update

## Overview
Updated `_OPERATIONS` table structure and refactored code to match new schema with composite PRIMARY KEY.

---

## New Table Structure

```sql
CREATE TABLE VENTA_OPERATIONS (
    client_id VARCHAR(100) NOT NULL,
    record_id VARCHAR(100) NOT NULL,
    batch_version VARCHAR(100) NOT NULL,
    field_id VARCHAR(50) NOT NULL,
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'ERROR')),
    error_message TEXT,
    input_data JSONB,
    batch_id VARCHAR(100),  -- job_id from queue
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (client_id, batch_version, record_id)
);
```

### Key Changes from Previous Structure

**Removed Fields:**
- ❌ `operation_id SERIAL PRIMARY KEY` - Replaced with composite key
- ❌ `plaza VARCHAR(50)` - No longer needed
- ❌ `output_data JSONB` - Simplified to only track input

**Modified Fields:**
- ✅ `batch_id` - Now represents `job_id` from Bull queue
- ✅ PRIMARY KEY changed to composite: `(client_id, batch_version, record_id)`
- ✅ Timestamps now use `TIMESTAMP WITH TIME ZONE`

**Benefits:**
1. **Natural Primary Key** - Uses business identifiers instead of surrogate key
2. **Automatic Deduplication** - Composite key prevents duplicate operations
3. **Simpler Schema** - Removed unnecessary fields
4. **Queue Integration** - `batch_id` directly maps to queue `job_id`

---

## Code Changes

### 1. OperationsRepository Updates

#### saveOperation() Method

**Changes:**
- Removed `plaza` extraction and field
- Removed `outputData` parameter and field
- Updated INSERT to match new column order
- Added `ON CONFLICT` clause for upsert behavior
- Simplified parameter list

**Before:**
```javascript
INSERT INTO ${operationsTableName} 
(client_id, plaza, record_id, field_id, operation, status, error_message, 
 input_data, output_data, batch_version, batch_id, created_at, processed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
```

**After:**
```javascript
INSERT INTO ${operationsTableName} 
(client_id, record_id, batch_version, field_id, operation, status, error_message, 
 input_data, batch_id, created_at, processed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (client_id, batch_version, record_id) 
DO UPDATE SET 
  field_id = EXCLUDED.field_id,
  operation = EXCLUDED.operation,
  status = EXCLUDED.status,
  error_message = EXCLUDED.error_message,
  input_data = EXCLUDED.input_data,
  batch_id = EXCLUDED.batch_id,
  processed_at = CURRENT_TIMESTAMP
```

**ON CONFLICT Behavior:**
- If record exists (same client_id + batch_version + record_id), it updates
- Useful for retries or status updates
- Preserves `created_at`, updates `processed_at`

#### Query Methods Updated

All SELECT queries updated to remove `operation_id`, `plaza`, and `output_data`:

**findOperationByRecord():**
```javascript
SELECT 
  client_id,
  record_id,
  batch_version,
  field_id,
  operation,
  status,
  error_message,
  input_data,
  batch_id,
  created_at,
  processed_at
FROM ${operationsTableName}
WHERE record_id = $1 
  AND client_id = $2
  AND batch_version = $3
LIMIT 1
```

**findOperationsByRecords():**
- Removed `DISTINCT ON (record_id)` - No longer needed with composite PK
- Same column list as above

**findOperationsByBatch():**
- Same column list
- Queries by `batch_id` (job_id)

---

### 2. PostgresService Updates

#### Method Signatures Updated

All methods now accept and pass `job_id` parameter:

**Before:**
```javascript
async batchInsert(client, records, tableName, clientId, fieldId, tableSchema, ver)
async batchUpdate(client, records, tableName, clientId, fieldId, tableSchema, ver)
async batchDelete(client, records, tableName, clientId, fieldId, ver)
async saveSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver)
async updateSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver)
async deleteSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver)
async processSingleRecords(client, records, tableName, clientId, fieldId, operation, tableSchema, ver)
```

**After:**
```javascript
async batchInsert(client, records, tableName, clientId, fieldId, tableSchema, ver, job_id)
async batchUpdate(client, records, tableName, clientId, fieldId, tableSchema, ver, job_id)
async batchDelete(client, records, tableName, clientId, fieldId, ver, job_id)
async saveSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver, job_id)
async updateSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver, job_id)
async deleteSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver, job_id)
async processSingleRecords(client, records, tableName, clientId, fieldId, operation, tableSchema, ver, job_id)
```

#### Repository Calls Updated

All `operationsRepository.saveOperation()` calls updated:

**Removed:**
- ❌ `outputData` parameter

**Added:**
- ✅ `batchId: job_id` parameter

**Example - batchInsert:**
```javascript
await operationsRepository.saveOperation({
  tableName,
  recordId: data.recordId,
  clientId,
  operation: 'CREATE',
  status: 'COMPLETED',
  fieldId,
  inputData: data.record,
  batchVersion: ver,
  batchId: job_id  // ← Added
});
```

**Total Updates:**
- 10 locations in PostgresService updated
- All batch methods (INSERT, UPDATE, DELETE)
- All single record methods
- processSingleRecords error handling

---

## Data Flow

### Queue Job → Operations Table

```
Bull Queue Job Created
  ↓
job.id = '12345'
  ↓
batchWorker.js calls postgresService.saveRecords(records, ..., job.id, ver)
  ↓
PostgresService passes job_id to batch methods
  ↓
Batch methods pass job_id to repository
  ↓
Repository saves with batchId: job_id
  ↓
VENTA_OPERATIONS table: batch_id = '12345'
```

### Composite Primary Key Usage

```
Record: { client_id: 'MTY_001', batch_version: 'v1.0', record_id: 'abc123' }
  ↓
First INSERT → Success
  ↓
Retry/Update with same keys → ON CONFLICT triggered
  ↓
Updates: status, error_message, processed_at
  ↓
Maintains: created_at (original timestamp)
```

---

## Migration Notes

### For Existing Tables

If you have existing `_OPERATIONS` tables with old structure:

```sql
-- 1. Backup existing data
CREATE TABLE venta_operations_backup AS SELECT * FROM venta_operations;

-- 2. Drop old table
DROP TABLE venta_operations;

-- 3. Create new table with new structure
CREATE TABLE venta_operations (
    client_id VARCHAR(100) NOT NULL,
    record_id VARCHAR(100) NOT NULL,
    batch_version VARCHAR(100) NOT NULL,
    field_id VARCHAR(50) NOT NULL,
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'ERROR')),
    error_message TEXT,
    input_data JSONB,
    batch_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (client_id, batch_version, record_id)
);

-- 4. Optionally migrate data (adjust as needed)
INSERT INTO venta_operations 
  (client_id, record_id, batch_version, field_id, operation, status, 
   error_message, input_data, batch_id, created_at, processed_at)
SELECT 
  client_id, record_id, batch_version, field_id, operation, status,
  error_message, input_data, batch_id, created_at, processed_at
FROM venta_operations_backup
ON CONFLICT (client_id, batch_version, record_id) DO NOTHING;
```

### For All 5 Tables

Repeat for each table:
- `venta_operations`
- `partvta_operations`
- `canota_operations`
- `cunota_operations`
- `xcorte_operations`

---

## Testing Checklist

### 1. Basic Operations
- [ ] CREATE operation logs successfully
- [ ] UPDATE operation logs successfully
- [ ] DELETE operation logs successfully
- [ ] batch_id contains job_id from queue

### 2. Composite Key Behavior
- [ ] Duplicate INSERT triggers ON CONFLICT
- [ ] ON CONFLICT updates status correctly
- [ ] ON CONFLICT preserves created_at
- [ ] ON CONFLICT updates processed_at

### 3. Special Cases
- [ ] Duplicate CREATE logs as COMPLETED
- [ ] DELETE not found logs as COMPLETED
- [ ] Error cases log with error_message

### 4. Query Methods
- [ ] findOperationByRecord returns correct data
- [ ] findOperationsByRecords handles multiple records
- [ ] findOperationsByBatch filters by job_id
- [ ] getBatchStatistics calculates correctly

### 5. Integration
- [ ] Queue job_id flows through to batch_id
- [ ] RecordStatusService queries work correctly
- [ ] No references to removed fields (plaza, output_data)

---

## Benefits Summary

### 1. **Simplified Schema** ✅
- Removed unnecessary fields
- Cleaner data model
- Easier to understand

### 2. **Natural Primary Key** ✅
- Business identifiers as key
- No need for surrogate key
- More meaningful queries

### 3. **Automatic Deduplication** ✅
- Composite key prevents duplicates
- ON CONFLICT handles retries
- No manual dedup logic needed

### 4. **Queue Integration** ✅
- batch_id = job_id
- Direct traceability
- Easy to query by job

### 5. **Better Performance** ✅
- Composite PK is efficient
- No need for DISTINCT ON
- Simpler queries

---

## API Compatibility

**No Breaking Changes** ✅

All external APIs remain the same:
- `POST /items` - Same request/response format
- `POST /records` - Same status check format
- Queue jobs - Same job structure

Only internal implementation changed.

---

## Files Modified

1. **src/repositories/operationsRepository.js**
   - Updated `saveOperation()` method
   - Updated all SELECT queries
   - Added ON CONFLICT clause

2. **src/services/postgresService.js**
   - Added `job_id` parameter to all methods
   - Removed `outputData` from repository calls
   - Added `batchId: job_id` to repository calls

3. **Documentation**
   - Created this migration guide
   - Updated REPOSITORY_REFACTOR.md (if needed)

---

## Rollback Plan

If issues arise:

1. Revert code changes (git revert)
2. Restore old table structure
3. Restore data from backup
4. Redeploy previous version

Keep backups for at least 7 days after migration.
