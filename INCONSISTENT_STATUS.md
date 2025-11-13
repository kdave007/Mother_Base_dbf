# INCONSISTENT Status Detection

## Overview
Added validation to detect database inconsistencies where operations are marked as `COMPLETED` in `_OPERATIONS` table but the corresponding record doesn't exist in the main table.

---

## Problem Statement

### Scenario
```
1. Operation CREATE/UPDATE executes
2. Operation logged in _OPERATIONS: status = 'COMPLETED'
3. Record should exist in main table
4. BUT: Record missing (manual deletion, transaction rollback, etc.)
5. Status query returns: COMPLETED with data: null ❌
```

### Why This Happens
- **Manual deletion** - DBA deletes record directly from main table
- **Transaction rollback** - Main table transaction rolled back but operations log committed
- **Database inconsistency** - Replication lag, corruption, etc.
- **Partial migration** - Operations table migrated but main table not

---

## Solution

### New Status: `INCONSISTENT`

When a `CREATE` or `UPDATE` operation is marked as `COMPLETED` but the record doesn't exist in the main table, return `INCONSISTENT` status instead of `COMPLETED`.

### Detection Logic

```
Operation status = 'COMPLETED'
  ↓
Check operation type
  ↓
  ├─ DELETE → Return: COMPLETED (expected to not exist)
  │
  └─ CREATE/UPDATE → Check main table
      ↓
      ├─ Record exists → Return: COMPLETED ✅
      │
      └─ Record NOT exists → Return: INCONSISTENT ⚠️
```

---

## Code Implementation

### RecordStatusService

**File:** `src/services/recordStatusService.js`

```javascript
// COMPLETED -> Verificar en tabla principal para obtener datos
else if (status === 'COMPLETED') {
  // Para DELETE COMPLETED, no buscar en tabla principal
  if (operation === 'DELETE') {
    results.push({
      [fieldId]: recordId,
      status: 'COMPLETED',
      note: 'Record was deleted',
      data: null
    });
  } else {
    // Para CREATE/UPDATE COMPLETED, verificar tabla principal y validar consistencia
    const mainTableResult = await this.checkMainTable(
      client, 
      tableName, 
      fieldId, 
      recordId, 
      clientId,
      ver
    );
    
    if (!mainTableResult.found) {
      // INCONSISTENCIA DETECTADA
      results.push({
        [fieldId]: recordId,
        status: 'INCONSISTENT',
        error_details: `Operation ${operation} marked as COMPLETED but record not found in main table. Possible causes: manual deletion, transaction rollback, or database inconsistency.`,
        data: null
      });
    } else {
      // COMPLETED VÁLIDO
      results.push({
        [fieldId]: recordId,
        status: 'COMPLETED',
        data: mainTableResult.data
      });
    }
  }
}
```

### PostgresService

**File:** `src/services/postgresService.js`

Same logic in `getRecordStatus()` method:

```javascript
if (status === 'COMPLETED') {
  if (operation === 'DELETE') {
    return {
      record_id: recordId,
      status: 'COMPLETED',
      source: 'operations_table',
      note: 'Record was deleted',
      data: null
    };
  } else {
    // Verificar tabla principal y validar consistencia
    const mainTableQuery = `...`;
    const mainResult = await client.query(mainTableQuery, [recordId, clientId, ver]);
    
    if (mainResult.rows.length === 0) {
      // INCONSISTENCIA DETECTADA
      return {
        record_id: recordId,
        status: 'INCONSISTENT',
        source: 'operations_table',
        error_message: `Operation ${operation} marked as COMPLETED but record not found in main table...`,
        data: null
      };
    } else {
      // COMPLETED VÁLIDO
      return {
        record_id: recordId,
        status: 'COMPLETED',
        source: 'operations_table',
        data: mainResult.rows[0]
      };
    }
  }
}
```

---

## Status Definitions

### All Possible Statuses

| Status | Meaning | When It Occurs |
|--------|---------|----------------|
| **COMPLETED** | Operation succeeded and record exists | Normal successful operation |
| **ERROR** | Operation failed | Validation error, constraint violation, etc. |
| **PROCESSING** | Operation in progress | QUEUED or PROCESSING status |
| **NOT_FOUND** | No record or operation found | Record never existed |
| **INCONSISTENT** ⚠️ | Operation completed but record missing | Database inconsistency detected |

---

## Response Format

### INCONSISTENT Response

**RecordStatusService:**
```json
{
  "hash_id": "abc123",
  "status": "INCONSISTENT",
  "error_details": "Operation CREATE marked as COMPLETED but record not found in main table. Possible causes: manual deletion, transaction rollback, or database inconsistency.",
  "data": null
}
```

**PostgresService:**
```json
{
  "record_id": "abc123",
  "status": "INCONSISTENT",
  "source": "operations_table",
  "error_message": "Operation UPDATE marked as COMPLETED but record not found in main table. Possible causes: manual deletion, transaction rollback, or database inconsistency.",
  "data": null
}
```

---

## Examples

### Example 1: Normal COMPLETED (Valid)

**Scenario:**
```
1. CREATE operation succeeds
2. Logged in _OPERATIONS: status = 'COMPLETED'
3. Record exists in main table
```

**Query Result:**
```json
{
  "hash_id": "abc123",
  "status": "COMPLETED",
  "data": {
    "_hash_id": "abc123",
    "_server_id": 1,
    "name": "John Doe"
  }
}
```

✅ **Valid COMPLETED** - Operation succeeded and record exists

---

### Example 2: INCONSISTENT (Invalid)

**Scenario:**
```
1. CREATE operation succeeds
2. Logged in _OPERATIONS: status = 'COMPLETED'
3. DBA manually deletes record from main table
4. Client queries status
```

**Query Result:**
```json
{
  "hash_id": "abc123",
  "status": "INCONSISTENT",
  "error_details": "Operation CREATE marked as COMPLETED but record not found in main table. Possible causes: manual deletion, transaction rollback, or database inconsistency.",
  "data": null
}
```

⚠️ **INCONSISTENT** - Operation says completed but record missing

---

### Example 3: DELETE COMPLETED (Valid)

**Scenario:**
```
1. DELETE operation succeeds
2. Logged in _OPERATIONS: status = 'COMPLETED'
3. Record doesn't exist in main table (expected)
```

**Query Result:**
```json
{
  "hash_id": "abc123",
  "status": "COMPLETED",
  "note": "Record was deleted",
  "data": null
}
```

✅ **Valid COMPLETED** - DELETE operations are expected to not have data

---

### Example 4: UPDATE INCONSISTENT

**Scenario:**
```
1. UPDATE operation succeeds
2. Logged in _OPERATIONS: status = 'COMPLETED'
3. Transaction rollback occurs (main table only)
4. Record missing from main table
```

**Query Result:**
```json
{
  "hash_id": "xyz789",
  "status": "INCONSISTENT",
  "error_details": "Operation UPDATE marked as COMPLETED but record not found in main table. Possible causes: manual deletion, transaction rollback, or database inconsistency.",
  "data": null
}
```

⚠️ **INCONSISTENT** - UPDATE completed but record vanished

---

## Causes of INCONSISTENT Status

### 1. Manual Deletion
```sql
-- DBA runs direct SQL
DELETE FROM venta WHERE _hash_id = 'abc123';
-- Operations table not updated
```

**Impact:** Record removed but operation still shows COMPLETED

---

### 2. Transaction Rollback
```javascript
// Transaction commits operations table
await operationsRepository.saveOperation({ status: 'COMPLETED' });

// Main table transaction rolls back
await client.query('ROLLBACK');
```

**Impact:** Operation logged but main table change reverted

---

### 3. Replication Lag
```
Primary DB: Record exists
  ↓
Replica DB: Record not yet replicated
  ↓
Query hits replica → Record not found
```

**Impact:** Temporary inconsistency (resolves when replication catches up)

---

### 4. Database Corruption
```
Disk error, power failure, etc.
  ↓
Main table data corrupted/lost
  ↓
Operations table intact
```

**Impact:** Permanent inconsistency requiring manual intervention

---

### 5. Partial Migration
```
Migrating from old system
  ↓
Operations table migrated
  ↓
Main table migration incomplete
```

**Impact:** Historical operations show COMPLETED but records missing

---

## Client Handling

### How Clients Should Handle INCONSISTENT

```javascript
const response = await fetch('/records', {
  method: 'POST',
  body: JSON.stringify({ hash_id: 'abc123', id_cola: 'job123' })
});

const result = await response.json();

switch (result.status) {
  case 'COMPLETED':
    // Success - use result.data
    console.log('Record:', result.data);
    break;
    
  case 'ERROR':
    // Operation failed - retry or handle error
    console.error('Error:', result.error_details);
    break;
    
  case 'PROCESSING':
    // Still processing - poll again later
    setTimeout(() => checkStatus(), 1000);
    break;
    
  case 'INCONSISTENT':
    // Database inconsistency - alert admin
    console.warn('INCONSISTENT:', result.error_details);
    alertAdmin({
      type: 'database_inconsistency',
      record_id: 'abc123',
      details: result.error_details
    });
    // Optionally retry the operation
    retryOperation('abc123');
    break;
    
  case 'NOT_FOUND':
    // Record never existed
    console.log('Not found');
    break;
}
```

---

## Monitoring & Alerts

### Detecting INCONSISTENT Records

**Query to find inconsistencies:**
```sql
-- Find COMPLETED operations with missing records
SELECT 
  o.client_id,
  o.record_id,
  o.operation,
  o.batch_id,
  o.created_at,
  o.processed_at
FROM venta_operations o
WHERE o.status = 'COMPLETED'
  AND o.operation IN ('CREATE', 'UPDATE')
  AND NOT EXISTS (
    SELECT 1 
    FROM venta v 
    WHERE v._hash_id = o.record_id 
      AND v._client_id = o.client_id
      AND v._ver = o.batch_version
  )
ORDER BY o.processed_at DESC;
```

### Alert Thresholds

- **0 inconsistencies** → Normal ✅
- **1-5 inconsistencies** → Warning ⚠️ (investigate)
- **>5 inconsistencies** → Critical 🚨 (immediate action)

---

## Resolution Strategies

### Strategy 1: Re-run Operation
```javascript
// Mark operation as ERROR
UPDATE venta_operations 
SET status = 'ERROR', 
    error_message = 'Inconsistency detected - record missing'
WHERE client_id = 'MTY_001' 
  AND record_id = 'abc123'
  AND batch_version = 'v1.0';

// Client retries operation
POST /items { id: 'abc123', ... }
```

### Strategy 2: Manual Data Recovery
```sql
-- Restore from backup
INSERT INTO venta SELECT * FROM venta_backup WHERE _hash_id = 'abc123';

-- Verify consistency
SELECT * FROM venta WHERE _hash_id = 'abc123';
```

### Strategy 3: Mark as Resolved
```sql
-- If record should not exist (intentional deletion)
UPDATE venta_operations 
SET operation = 'DELETE'
WHERE client_id = 'MTY_001' 
  AND record_id = 'abc123'
  AND batch_version = 'v1.0';
```

---

## Testing

### Test Case 1: Detect INCONSISTENT CREATE
```javascript
// 1. Create record
await postgresService.saveRecords([{ id: 'test1', name: 'Test' }], ...);

// 2. Manually delete from main table
await client.query("DELETE FROM venta WHERE _hash_id = 'test1'");

// 3. Query status
const status = await recordStatusService.checkRecordsStatus(...);

// 4. Assert
expect(status[0].status).toBe('INCONSISTENT');
expect(status[0].error_details).toContain('not found in main table');
```

### Test Case 2: Valid COMPLETED
```javascript
// 1. Create record
await postgresService.saveRecords([{ id: 'test2', name: 'Test' }], ...);

// 2. Query status (no deletion)
const status = await recordStatusService.checkRecordsStatus(...);

// 3. Assert
expect(status[0].status).toBe('COMPLETED');
expect(status[0].data).toBeTruthy();
```

### Test Case 3: DELETE COMPLETED (Not Inconsistent)
```javascript
// 1. Create record
await postgresService.saveRecords([{ id: 'test3', name: 'Test' }], ...);

// 2. Delete record
await postgresService.saveRecords([{ id: 'test3' }], ..., 'delete');

// 3. Query status
const status = await recordStatusService.checkRecordsStatus(...);

// 4. Assert
expect(status[0].status).toBe('COMPLETED');
expect(status[0].note).toBe('Record was deleted');
expect(status[0].data).toBeNull();
```

---

## Benefits

### 1. **Early Detection** ✅
- Inconsistencies detected immediately
- No silent data loss
- Clear error messages

### 2. **Better Debugging** ✅
- Identifies root cause (manual deletion, rollback, etc.)
- Helps track down database issues
- Provides actionable information

### 3. **Data Integrity** ✅
- Validates operations table against reality
- Ensures COMPLETED means truly completed
- Maintains trust in status responses

### 4. **Monitoring** ✅
- Can track inconsistency rates
- Alert on database issues
- Proactive problem detection

---

## Summary

### Status Hierarchy

```
COMPLETED (valid)
  ↓ Record exists in main table
  
INCONSISTENT (invalid)
  ↓ Record missing from main table
  
ERROR (failed)
  ↓ Operation never succeeded
```

### Key Points

- **INCONSISTENT** = Operation says COMPLETED but record missing
- **Only for CREATE/UPDATE** - DELETE is expected to not have data
- **Validation added** - Both RecordStatusService and PostgresService
- **Clear error messages** - Explains possible causes
- **Actionable** - Clients can alert admins or retry

### Impact

**Before:** `COMPLETED` with `data: null` (confusing) ❌  
**After:** `INCONSISTENT` with clear error message (actionable) ✅

Database inconsistencies are now **detected and reported** instead of silently returning incomplete data! 🎉
