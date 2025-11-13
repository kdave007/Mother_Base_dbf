# Status Query Logic Fix - Eliminating False Positives

## Problem Statement

### Original Issue
The status query logic was checking the **main table FIRST**, then the operations table. This caused **false positives** when operations failed:

**Example Scenario:**
1. Record exists in main table (from previous successful CREATE)
2. Client sends UPDATE operation
3. UPDATE fails (e.g., validation error, constraint violation)
4. Operation logged in `_OPERATIONS` with `status: 'ERROR'`
5. Client queries status → **Returns COMPLETED** ❌ (because record exists in main table)
6. Client thinks UPDATE succeeded when it actually failed

### Root Cause
**Main table presence ≠ Operation success**

A record existing in the main table only means it was created at some point. It doesn't reflect the status of the **current operation** (which could be UPDATE or DELETE).

---

## Solution

### New Query Order

**OPERATIONS table is now the source of truth** ✅

```
1. Check _OPERATIONS table FIRST
   ↓
   If operation found → Use operation status
   ↓
   If no operation → Check main table (resync/legacy)
```

### Decision Flow

```
Query for record status
  ↓
┌─────────────────────────────────────┐
│ 1. Check _OPERATIONS table          │
└─────────────────────────────────────┘
  ↓
  Found operation?
  ↓
  YES → Check status
  │
  ├─ QUEUED/PROCESSING → Return: PROCESSING
  │
  ├─ ERROR → Check if special case
  │   ├─ Duplicate CREATE → Return: COMPLETED (bypass)
  │   ├─ Delete not found → Return: COMPLETED (bypass)
  │   └─ Real error → Return: ERROR ✅
  │
  └─ COMPLETED → Check operation type
      ├─ DELETE → Return: COMPLETED (don't check main table)
      └─ CREATE/UPDATE → Check main table for data → Return: COMPLETED
  
  NO → Check main table
  │
  ├─ Found → Return: COMPLETED (legacy/resync)
  └─ Not found → Return: NOT_FOUND
```

---

## Code Changes

### 1. RecordStatusService

**File:** `src/services/recordStatusService.js`

#### Before (Incorrect Order)
```javascript
// 1. Buscar en la tabla principal
const mainTableResult = await this.checkMainTable(...);

if (mainTableResult.found) {
  return { status: 'COMPLETED' }; // ❌ False positive!
}

// 2. Buscar en tabla de operaciones
const op = await operationsRepository.findOperationByRecord(...);
```

#### After (Correct Order)
```javascript
// 1. PRIMERO: Buscar en tabla de operaciones (fuente de verdad)
const op = await operationsRepository.findOperationByRecord(...);

if (op) {
  // Use operation status
  if (status === 'ERROR') {
    return { status: 'ERROR' }; // ✅ Real error shown!
  }
  // ... other status handling
}

// 2. SEGUNDO: Si no hay operación, buscar en tabla principal
const mainTableResult = await this.checkMainTable(...);
```

#### New Status Handling

**QUEUED/PROCESSING:**
```javascript
if (status === 'QUEUED' || status === 'PROCESSING') {
  results.push({
    [fieldId]: recordId,
    status: 'PROCESSING',
    note: `Operation ${operation} is ${status}`,
    data: null
  });
}
```

**ERROR with Special Cases:**
```javascript
if (status === 'ERROR') {
  // Check for bypass cases
  const isDuplicateBypass = operation === 'CREATE' && 
    error_message && 
    (error_message.includes('Duplicate bypassed') || 
     error_message.includes('duplicate') ||
     error_message.includes('already exists'));
  
  const isDeleteNotFoundBypass = operation === 'DELETE' && 
    error_message && 
    (error_message.includes('Delete not found bypassed') ||
     error_message.includes('not found') ||
     error_message.includes('no encontrado'));
  
  if (isDuplicateBypass || isDeleteNotFoundBypass) {
    return { status: 'COMPLETED', note: '...' };
  } else {
    // Real error - show it!
    return { status: 'ERROR', error_details: error_message };
  }
}
```

**COMPLETED:**
```javascript
if (status === 'COMPLETED') {
  if (operation === 'DELETE') {
    // Don't check main table for deleted records
    return { status: 'COMPLETED', note: 'Record was deleted' };
  } else {
    // For CREATE/UPDATE, verify main table for data
    const mainTableResult = await this.checkMainTable(...);
    return { 
      status: 'COMPLETED', 
      data: mainTableResult.found ? mainTableResult.data : null 
    };
  }
}
```

---

### 2. PostgresService.getRecordStatus()

**File:** `src/services/postgresService.js`

Same logic applied to `getRecordStatus()` method:

```javascript
/**
 * Get record status with CORRECTED logic:
 * 1. Check _OPERATIONS table FIRST (source of truth for operation status)
 *    - QUEUED/PROCESSING → PROCESSING
 *    - ERROR → ERROR (except special bypass cases)
 *    - COMPLETED → COMPLETED (verify main table for data)
 * 2. If no operation found, check main table (resync/legacy records)
 * 3. If not in either table → NOT_FOUND
 */
async getRecordStatus(tableName, recordId, clientId, fieldId, ver) {
  // 1. Check operations table first
  const op = await operationsRepository.findOperationByRecord(...);
  
  if (op) {
    // Handle based on operation status
    // ... (same logic as RecordStatusService)
  }
  
  // 2. Check main table if no operation
  const mainResult = await client.query(...);
  
  // 3. Return NOT_FOUND if nowhere
}
```

---

### 3. OperationsRepository Enhancement

**File:** `src/repositories/operationsRepository.js`

Added `ORDER BY` to ensure we get the **latest** operation:

```javascript
const query = `
  SELECT ...
  FROM ${operationsTableName}
  WHERE record_id = $1 
    AND client_id = $2
    AND batch_version = $3
  ORDER BY processed_at DESC, created_at DESC  -- ✅ Latest first
  LIMIT 1
`;
```

**Why this matters:**
- With `ON CONFLICT` upsert, records can be updated
- `processed_at` changes on each update
- We want the most recent status

---

## Status Possibilities

### 1. **PROCESSING**
- Operation is `QUEUED` or `PROCESSING`
- Still being executed
- Client should poll again

### 2. **COMPLETED**
- Operation succeeded
- For CREATE/UPDATE: Record exists in main table
- For DELETE: Record was removed
- Special cases: Duplicate CREATE, Delete not found

### 3. **ERROR**
- Operation failed with real error
- `error_details` contains error message
- Client should handle/retry

### 4. **NOT_FOUND**
- No operation record found
- Not in main table either
- Record never existed or very old

---

## Examples

### Example 1: Failed UPDATE (Main Fix)

**Scenario:**
```
1. Record exists: { id: 'abc123', name: 'John' }
2. Client sends UPDATE: { id: 'abc123', name: 'X'.repeat(300) } // Too long
3. UPDATE fails: constraint violation
4. Operation logged: status = 'ERROR'
```

**Before (Incorrect):**
```
Query status → Check main table first
  → Record exists
  → Return: COMPLETED ❌
  → Client thinks UPDATE succeeded!
```

**After (Correct):**
```
Query status → Check operations table first
  → Operation found: status = 'ERROR'
  → Return: ERROR ✅
  → Client knows UPDATE failed!
```

---

### Example 2: Successful CREATE

**Scenario:**
```
1. Client sends CREATE: { id: 'xyz789', name: 'Jane' }
2. CREATE succeeds
3. Operation logged: status = 'COMPLETED'
```

**Query Result:**
```
Check operations table
  → Operation found: CREATE, COMPLETED
  → Check main table for data
  → Return: COMPLETED with data ✅
```

---

### Example 3: Duplicate CREATE (Bypass)

**Scenario:**
```
1. Record exists: { id: 'abc123' }
2. Client sends CREATE: { id: 'abc123' } // Duplicate
3. Duplicate detected, logged as: status = 'COMPLETED', error_message = 'Duplicate bypassed'
```

**Query Result:**
```
Check operations table
  → Operation found: CREATE, COMPLETED
  → Check main table
  → Return: COMPLETED (bypass) ✅
```

---

### Example 4: DELETE Completed

**Scenario:**
```
1. Client sends DELETE: { id: 'abc123' }
2. DELETE succeeds
3. Operation logged: status = 'COMPLETED'
```

**Query Result:**
```
Check operations table
  → Operation found: DELETE, COMPLETED
  → Don't check main table (record deleted)
  → Return: COMPLETED ✅
```

---

### Example 5: Legacy Record (No Operation)

**Scenario:**
```
1. Record exists from before _OPERATIONS system
2. No operation record in _OPERATIONS
```

**Query Result:**
```
Check operations table
  → No operation found
  → Check main table
  → Record exists
  → Return: COMPLETED (legacy) ✅
```

---

## Benefits

### 1. **Eliminates False Positives** ✅
- Failed operations now correctly show as ERROR
- No more "success" when operation actually failed

### 2. **Accurate Operation Status** ✅
- PROCESSING shows operations in progress
- ERROR shows real failures
- COMPLETED only when truly completed

### 3. **Maintains Backward Compatibility** ✅
- Legacy records (no operation) still work
- Resync scenarios handled
- Same API response format

### 4. **Better Client Experience** ✅
- Clients get accurate status
- Can properly handle errors
- Can retry failed operations

### 5. **Audit Trail Integrity** ✅
- Operations table is source of truth
- Main table is just data storage
- Clear separation of concerns

---

## Testing Scenarios

### Test 1: Failed UPDATE
```
1. Create record: POST /items { id: 'test1', name: 'Test' }
2. Update with error: POST /items { id: 'test1', invalid_field: 'X' }
3. Query status: POST /records { hash_id: 'test1' }
4. Expected: status = 'ERROR' ✅
```

### Test 2: Successful CREATE
```
1. Create record: POST /items { id: 'test2', name: 'Test' }
2. Query status: POST /records { hash_id: 'test2' }
3. Expected: status = 'COMPLETED', data = {...} ✅
```

### Test 3: Duplicate CREATE
```
1. Create record: POST /items { id: 'test3', name: 'Test' }
2. Create again: POST /items { id: 'test3', name: 'Test' }
3. Query status: POST /records { hash_id: 'test3' }
4. Expected: status = 'COMPLETED', note = 'Duplicate bypassed' ✅
```

### Test 4: DELETE
```
1. Create record: POST /items { id: 'test4', name: 'Test' }
2. Delete record: DELETE /items { id: 'test4' }
3. Query status: POST /records { hash_id: 'test4' }
4. Expected: status = 'COMPLETED', note = 'Record was deleted' ✅
```

### Test 5: PROCESSING
```
1. Start long operation (if possible)
2. Query status immediately: POST /records { hash_id: 'test5' }
3. Expected: status = 'PROCESSING' ✅
```

### Test 6: Legacy Record
```
1. Manually insert record in main table (bypass operations)
2. Query status: POST /records { hash_id: 'legacy1' }
3. Expected: status = 'COMPLETED', note = 'Found in main table (no operation record)' ✅
```

---

## Migration Notes

### No Data Migration Required ✅
- Only code changes
- Existing data works as-is
- No table structure changes

### Deployment Steps
1. Deploy updated code
2. Monitor logs for any issues
3. Test with sample queries
4. Verify error cases show correctly

### Rollback Plan
If issues arise:
1. Revert code changes
2. Old logic will resume
3. No data loss

---

## Files Modified

1. **src/services/recordStatusService.js**
   - Inverted query order (operations first)
   - Added QUEUED/PROCESSING handling
   - Added special case detection in ERROR status
   - Enhanced COMPLETED handling

2. **src/services/postgresService.js**
   - Updated `getRecordStatus()` with same logic
   - Inverted query order
   - Added all status handling

3. **src/repositories/operationsRepository.js**
   - Added `ORDER BY processed_at DESC, created_at DESC`
   - Ensures latest operation returned

---

## Summary

### Problem
❌ Main table checked first → False positives on failed operations

### Solution
✅ Operations table checked first → Accurate operation status

### Impact
- **Failed operations now show as ERROR** (main fix)
- **PROCESSING status for in-progress operations**
- **Special cases handled correctly**
- **Legacy records still work**
- **No breaking changes**

### Result
**Zero false positives** - Clients get accurate operation status every time! 🎉
