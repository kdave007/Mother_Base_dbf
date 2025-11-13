# Operation Resync Logic - Forcing Operation History Recreation

## Overview
When operation records are missing from `_OPERATIONS` but data exists in main table, the system now returns `ERROR` status to force clients to resend and recreate the operation history.

---

## Problem Statement

### Scenario
```
1. Record exists in main table (from previous CREATE)
2. Operation record deleted from _OPERATIONS (manual deletion, cleanup, etc.)
3. Client queries status
4. OLD BEHAVIOR: Returns COMPLETED → Client doesn't resend
5. RESULT: No operation history, no audit trail ❌
```

### Why This Is Bad
- **Lost audit trail** - No record of who/when/what
- **Incomplete tracking** - Can't trace operation history
- **Inconsistent state** - Data exists but no operation logged
- **Compliance issues** - Missing required audit logs

---

## Solution

### Force Resend via ERROR Status

**New Logic:**
```
No operation in _OPERATIONS
  ↓
Check main table
  ↓
  ├─ Record EXISTS → Return: ERROR (force resend)
  │   "Operation record missing but data exists - please resend"
  │
  └─ Record NOT EXISTS → Return: NOT_FOUND
```

### Resync Flow

```
1. Client queries status
   ↓
2. Server: No operation + Record exists
   ↓
3. Return: ERROR (missing operation)
   ↓
4. Client sees ERROR → Resends record
   ↓
5. Server processes resend:
   ├─ CREATE → Duplicate detected → COMPLETED in _OPERATIONS ✅
   ├─ UPDATE → Executes normally → COMPLETED in _OPERATIONS ✅
   └─ DELETE → Executes normally → COMPLETED in _OPERATIONS ✅
   ↓
6. Next query: Operation exists → Returns COMPLETED
   ↓
7. RESULT: Operation history recreated! ✅
```

---

## Code Implementation

### RecordStatusService

**File:** `src/services/recordStatusService.js`

```javascript
} else {
  // 2. SEGUNDO: Si no hay operación registrada, buscar en tabla principal
  const mainTableResult = await this.checkMainTable(
    client, 
    tableName, 
    fieldId, 
    recordId, 
    clientId,
    ver
  );
  
  if (mainTableResult.found) {
    // Operations faltante pero registro existe - ERROR para forzar reenvío
    results.push({
      [fieldId]: recordId,
      status: 'ERROR',
      error_details: 'Operation record missing but data exists in main table - please resend to recreate operation history',
      data: null
    });
  } else {
    // 3. No encontrado en ninguna tabla
    results.push({
      [fieldId]: recordId,
      status: 'NOT_FOUND',
      data: null
    });
  }
}
```

### PostgresService

**File:** `src/services/postgresService.js`

```javascript
// 2. SEGUNDO: Si no hay operación registrada, buscar en tabla principal
const mainTableQuery = `...`;
const mainResult = await client.query(mainTableQuery, [recordId, clientId, ver]);

if (mainResult.rows.length > 0) {
  // Operations faltante pero registro existe - ERROR para forzar reenvío
  return {
    record_id: recordId,
    status: 'ERROR',
    source: 'main_table',
    error_message: 'Operation record missing but data exists in main table - please resend to recreate operation history',
    data: null
  };
}

// 3. No encontrado en ninguna tabla
return {
  record_id: recordId,
  status: 'NOT_FOUND',
  source: 'none',
  data: null
};
```

---

## Status Decision Tree

```
Query record status
  ↓
┌─────────────────────────────────────┐
│ 1. Check _OPERATIONS table          │
└─────────────────────────────────────┘
  ↓
  Operation found?
  ↓
  YES → Use operation status (PROCESSING/COMPLETED/ERROR)
  │
  NO → Check main table
       ↓
       ├─ Record EXISTS
       │    ↓
       │    Return: ERROR ⚠️
       │    "Operation missing - resend to recreate history"
       │
       └─ Record NOT EXISTS
            ↓
            Return: NOT_FOUND
```

---

## Examples

### Example 1: Missing Operation - Force Resend

**Initial State:**
```
Main table: { _hash_id: 'abc123', name: 'John' }
Operations table: (empty - deleted manually)
```

**Query Status:**
```json
POST /records
{
  "hash_id": "abc123",
  "id_cola": "job123"
}
```

**Response:**
```json
{
  "hash_id": "abc123",
  "status": "ERROR",
  "error_details": "Operation record missing but data exists in main table - please resend to recreate operation history",
  "data": null
}
```

**Client Action:**
```javascript
// Client sees ERROR, resends record
POST /items
{
  "id": "abc123",
  "name": "John"
}
```

**Server Processing:**
```
1. Receives CREATE for 'abc123'
2. Detects duplicate (record exists)
3. Logs operation: CREATE, COMPLETED, "Duplicate bypassed"
4. Returns: success
```

**After Resend:**
```
Main table: { _hash_id: 'abc123', name: 'John' }
Operations table: { record_id: 'abc123', operation: 'CREATE', status: 'COMPLETED' } ✅
```

**Next Query:**
```json
{
  "hash_id": "abc123",
  "status": "COMPLETED",
  "data": { "_hash_id": "abc123", "name": "John" }
}
```

✅ **Operation history recreated!**

---

### Example 2: Truly Not Found

**Initial State:**
```
Main table: (empty)
Operations table: (empty)
```

**Query Status:**
```json
POST /records
{
  "hash_id": "xyz999",
  "id_cola": "job456"
}
```

**Response:**
```json
{
  "hash_id": "xyz999",
  "status": "NOT_FOUND",
  "data": null
}
```

**Client Action:**
```javascript
// Client knows record never existed
// Can create new record if needed
```

---

### Example 3: Normal Operation Exists

**Initial State:**
```
Main table: { _hash_id: 'def456', name: 'Jane' }
Operations table: { record_id: 'def456', operation: 'CREATE', status: 'COMPLETED' }
```

**Query Status:**
```json
POST /records
{
  "hash_id": "def456",
  "id_cola": "job789"
}
```

**Response:**
```json
{
  "hash_id": "def456",
  "status": "COMPLETED",
  "data": { "_hash_id": "def456", "name": "Jane" }
}
```

✅ **Normal flow - no resend needed**

---

## Resend Processing

### CREATE Resend (Duplicate)

**Scenario:** Record exists, client resends CREATE

```javascript
// Server detects duplicate
if (isDuplicateError(error)) {
  // Log as COMPLETED with bypass note
  await operationsRepository.saveOperation({
    operation: 'CREATE',
    status: 'COMPLETED',
    error: { message: 'Duplicate bypassed' }
  });
  
  return { status: 'success', note: 'Duplicate bypassed' };
}
```

**Result:** Operation history recreated ✅

---

### UPDATE Resend

**Scenario:** Record exists, client resends UPDATE

```javascript
// Server executes UPDATE normally
await client.query('UPDATE venta SET ... WHERE _hash_id = $1', [recordId]);

// Log as COMPLETED
await operationsRepository.saveOperation({
  operation: 'UPDATE',
  status: 'COMPLETED'
});

return { status: 'success' };
```

**Result:** Operation history recreated + data updated ✅

---

### DELETE Resend

**Scenario:** Record exists, client resends DELETE

```javascript
// Server executes DELETE normally
await client.query('DELETE FROM venta WHERE _hash_id = $1', [recordId]);

// Log as COMPLETED
await operationsRepository.saveOperation({
  operation: 'DELETE',
  status: 'COMPLETED'
});

return { status: 'success' };
```

**Result:** Operation history recreated + record deleted ✅

---

## Client Implementation

### Handling Missing Operation Error

```javascript
async function syncRecord(recordId) {
  // 1. Query status
  const statusResponse = await fetch('/records', {
    method: 'POST',
    body: JSON.stringify({ hash_id: recordId, id_cola: 'job123' })
  });
  
  const status = await statusResponse.json();
  
  // 2. Handle status
  switch (status.status) {
    case 'COMPLETED':
      // All good
      console.log('Record synced:', status.data);
      break;
      
    case 'ERROR':
      // Check if it's missing operation error
      if (status.error_details?.includes('Operation record missing')) {
        console.log('Operation missing - resending to recreate history');
        
        // 3. Resend record
        const record = await getRecordFromLocalDB(recordId);
        await fetch('/items', {
          method: 'POST',
          body: JSON.stringify(record)
        });
        
        console.log('Record resent - operation history will be recreated');
      } else {
        // Real error
        console.error('Error:', status.error_details);
      }
      break;
      
    case 'NOT_FOUND':
      // Record never existed
      console.log('Record not found - can create new');
      break;
      
    case 'PROCESSING':
      // Still processing
      console.log('Processing - check again later');
      setTimeout(() => syncRecord(recordId), 1000);
      break;
  }
}
```

---

## Benefits

### 1. **Audit Trail Restoration** ✅
- Missing operations get recreated
- Complete history maintained
- Compliance requirements met

### 2. **Self-Healing** ✅
- System automatically triggers resync
- No manual intervention needed
- Client handles resend automatically

### 3. **Data Consistency** ✅
- Operations table matches main table
- No orphaned records
- Complete tracking

### 4. **Transparency** ✅
- Clear error message
- Client knows what to do
- Predictable behavior

---

## Monitoring

### Detecting Missing Operations

**Query to find records without operations:**
```sql
-- Find records in main table without operations
SELECT 
  v._hash_id,
  v._client_id,
  v._ver,
  v._created_at
FROM venta v
WHERE NOT EXISTS (
  SELECT 1 
  FROM venta_operations o 
  WHERE o.record_id = v._hash_id 
    AND o.client_id = v._client_id
    AND o.batch_version = v._ver
)
ORDER BY v._created_at DESC
LIMIT 100;
```

### Alert Thresholds

- **0-10 missing** → Normal (recent operations) ✅
- **10-100 missing** → Warning ⚠️ (investigate)
- **>100 missing** → Critical 🚨 (bulk deletion?)

---

## Edge Cases

### Case 1: Bulk Operation Deletion

**Scenario:** DBA deletes all operations for a client

```sql
DELETE FROM venta_operations WHERE client_id = 'MTY_001';
```

**Impact:**
- All records for that client return ERROR on query
- Client resends all records
- All operations recreated

**Mitigation:** Batch resend to avoid overload

---

### Case 2: Partial Sync

**Scenario:** New client syncing for first time

```
Client has 10,000 records locally
Server has 0 operations
```

**Flow:**
1. Client queries all 10,000 → All return ERROR
2. Client resends all 10,000
3. Server processes (duplicates → COMPLETED)
4. Operations table populated

**Optimization:** Batch processing, rate limiting

---

### Case 3: Race Condition

**Scenario:** Query happens during operation processing

```
T1: Operation starts (not yet in _OPERATIONS)
T2: Client queries status
T3: Query finds record but no operation → ERROR
T4: Operation completes and logs
```

**Impact:** False ERROR, client resends unnecessarily

**Mitigation:** 
- QUEUED status logged immediately
- Query sees PROCESSING, not ERROR

---

## Summary

### Old Behavior (Wrong)
```
No operation + Record exists → COMPLETED
  ↓
Client doesn't resend
  ↓
Operation history lost forever ❌
```

### New Behavior (Correct)
```
No operation + Record exists → ERROR
  ↓
Client resends
  ↓
Operation history recreated ✅
```

### Key Points

- **ERROR forces resend** - Client must recreate operation
- **Self-healing system** - Automatically recovers from missing operations
- **Audit trail preserved** - All operations eventually logged
- **Transparent** - Clear error messages guide client behavior

### Impact

**Before:** Missing operations = lost audit trail ❌  
**After:** Missing operations = automatic recreation ✅

System now **self-heals** when operation records are missing! 🎉
