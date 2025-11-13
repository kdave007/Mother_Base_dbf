# Repository Pattern Refactor

## Overview
Separated database query logic from business logic by creating `OperationsRepository` class to handle all `_OPERATIONS` table queries.

---

## Architecture Changes

### Before
```
PostgresService
├── Business logic (batch processing, error detection)
├── Database queries (main tables)
└── Database queries (_OPERATIONS tables) ❌ Mixed concerns

RecordStatusService
├── Status check logic
├── Database queries (main tables)
└── Database queries (_OPERATIONS tables) ❌ Mixed concerns
```

### After
```
OperationsRepository ✅ Single responsibility
└── All _OPERATIONS table queries

PostgresService
├── Business logic (batch processing, error detection)
├── Database queries (main tables only)
└── Uses OperationsRepository for _OPERATIONS

RecordStatusService
├── Status check logic
├── Database queries (main tables only)
└── Uses OperationsRepository for _OPERATIONS
```

---

## New File: `src/repositories/operationsRepository.js`

### Methods

#### 1. **saveOperation(params)**
Saves an operation record to `_OPERATIONS` table.

**Parameters:**
```javascript
{
  tableName: string,      // Main table name (e.g., 'venta')
  recordId: string,       // Record identifier
  clientId: string,       // Client identifier
  operation: string,      // 'CREATE', 'UPDATE', 'DELETE'
  status: string,         // 'QUEUED', 'PROCESSING', 'COMPLETED', 'ERROR'
  error: object,          // Error object (optional)
  fieldId: string,        // Field used as ID
  inputData: object,      // Input data (JSONB)
  outputData: object,     // Output data (JSONB)
  batchVersion: string,   // Batch version
  batchId: string         // Batch ID (optional)
}
```

**Usage:**
```javascript
await operationsRepository.saveOperation({
  tableName: 'venta',
  recordId: 'abc123',
  clientId: 'MTY_001',
  operation: 'CREATE',
  status: 'COMPLETED',
  fieldId: 'hash_id',
  inputData: record,
  outputData: { postgres_id: 456 },
  batchVersion: 'v1.0'
});
```

---

#### 2. **findOperationByRecord(tableName, recordId, clientId, batchVersion)**
Finds the most recent operation for a specific record.

**Returns:** `Object | null`

**Usage:**
```javascript
const op = await operationsRepository.findOperationByRecord(
  'venta', 
  'abc123', 
  'MTY_001', 
  'v1.0'
);

if (op) {
  console.log(op.operation);  // 'CREATE'
  console.log(op.status);     // 'COMPLETED'
  console.log(op.error_message);
}
```

---

#### 3. **findOperationsByRecords(tableName, recordIds, clientId, batchVersion)**
Finds operations for multiple records (batch query).

**Returns:** `Array<Object>`

**Usage:**
```javascript
const operations = await operationsRepository.findOperationsByRecords(
  'venta',
  ['abc123', 'def456', 'ghi789'],
  'MTY_001',
  'v1.0'
);

operations.forEach(op => {
  console.log(`${op.record_id}: ${op.status}`);
});
```

---

#### 4. **findOperationsByBatch(tableName, batchId, clientId)**
Finds all operations for a specific batch.

**Returns:** `Array<Object>`

**Usage:**
```javascript
const batchOps = await operationsRepository.findOperationsByBatch(
  'venta',
  'batch_20231113_001',
  'MTY_001'
);

console.log(`Total operations: ${batchOps.length}`);
```

---

#### 5. **getBatchStatistics(tableName, batchId, clientId)**
Gets statistics for a batch (counts by operation and status).

**Returns:**
```javascript
{
  total: number,
  by_operation: {
    CREATE: number,
    UPDATE: number,
    DELETE: number
  },
  by_status: {
    COMPLETED: number,
    ERROR: number
  }
}
```

**Usage:**
```javascript
const stats = await operationsRepository.getBatchStatistics(
  'venta',
  'batch_20231113_001',
  'MTY_001'
);

console.log(`Total: ${stats.total}`);
console.log(`Completed: ${stats.by_status.COMPLETED}`);
console.log(`Errors: ${stats.by_status.ERROR}`);
```

---

#### 6. **operationExists(tableName, recordId, clientId, batchVersion)**
Checks if an operation exists for a record.

**Returns:** `boolean`

**Usage:**
```javascript
const exists = await operationsRepository.operationExists(
  'venta',
  'abc123',
  'MTY_001',
  'v1.0'
);

if (exists) {
  console.log('Operation already logged');
}
```

---

#### 7. **deleteOldOperations(tableName, daysOld)**
Deletes operations older than specified days (maintenance).

**Returns:** `number` (count of deleted records)

**Usage:**
```javascript
// Delete operations older than 30 days
const deleted = await operationsRepository.deleteOldOperations('venta', 30);
console.log(`Deleted ${deleted} old operations`);
```

---

## Changes to PostgresService

### Removed Method
- ❌ `saveToOperationsTable()` - Moved to repository

### Updated Methods
All methods now use `operationsRepository.saveOperation()`:

1. **processSingleRecords()** - Uses repository for error logging
2. **batchInsert()** - Uses repository for success logging
3. **batchUpdate()** - Uses repository for success/error logging
4. **batchDelete()** - Uses repository for success/bypass logging
5. **saveSingleRecord()** - Uses repository for success logging
6. **updateSingleRecord()** - Uses repository for success logging
7. **deleteSingleRecord()** - Uses repository for success logging
8. **getRecordStatus()** - Uses repository for operation lookup

### Example Change
**Before:**
```javascript
await this.saveToOperationsTable({
  tableName,
  recordId,
  clientId,
  operation: 'CREATE',
  status: 'COMPLETED',
  fieldId,
  inputData: record,
  outputData: { postgres_id: postgresId },
  ver
});
```

**After:**
```javascript
await operationsRepository.saveOperation({
  tableName,
  recordId,
  clientId,
  operation: 'CREATE',
  status: 'COMPLETED',
  fieldId,
  inputData: record,
  outputData: { postgres_id: postgresId },
  batchVersion: ver
});
```

---

## Changes to RecordStatusService

### Removed Method
- ❌ `checkOperationsTable()` - Replaced with repository call

### Updated Methods
**checkRecordsStatus()** now uses `operationsRepository.findOperationByRecord()`

**Before:**
```javascript
const operationsResult = await this.checkOperationsTable(
  client,
  tableName,
  recordId,
  clientId,
  ver
);

if (operationsResult.found) {
  const { operation, status, error_message } = operationsResult;
  // ...
}
```

**After:**
```javascript
const op = await operationsRepository.findOperationByRecord(
  tableName,
  recordId,
  clientId,
  ver
);

if (op) {
  const { operation, status, error_message } = op;
  // ...
}
```

---

## Benefits

### 1. **Separation of Concerns** ✅
- Repository handles **only** database queries
- Services handle **only** business logic
- Clear boundaries between layers

### 2. **Reusability** ✅
- Repository methods can be used by any service
- No code duplication for common queries
- Easy to add new services that need operations data

### 3. **Testability** ✅
- Repository can be mocked easily in tests
- Services can be tested without database
- Clear interface for testing

### 4. **Maintainability** ✅
- Query logic in one place
- Easy to optimize queries
- Easy to add new query methods

### 5. **Consistency** ✅
- All _OPERATIONS queries use same patterns
- Consistent error handling
- Consistent parameter naming

---

## Usage Examples

### Example 1: Log Successful Operation
```javascript
// In any service
await operationsRepository.saveOperation({
  tableName: 'partvta',
  recordId: record.id,
  clientId: 'MTY_001',
  operation: 'UPDATE',
  status: 'COMPLETED',
  fieldId: 'recno_id',
  inputData: record,
  outputData: { updated_fields: ['cantidad', 'precio'] },
  batchVersion: 'v2.0'
});
```

### Example 2: Check Operation Status
```javascript
// In any service
const op = await operationsRepository.findOperationByRecord(
  'canota',
  'nota_123',
  'GDL_002',
  'v1.5'
);

if (op && op.status === 'ERROR') {
  console.error(`Operation failed: ${op.error_message}`);
  // Handle error
}
```

### Example 3: Batch Statistics
```javascript
// In monitoring/reporting service
const stats = await operationsRepository.getBatchStatistics(
  'xcorte',
  'batch_morning_001',
  'QRO_003'
);

console.log(`
  Batch Summary:
  - Total operations: ${stats.total}
  - Creates: ${stats.by_operation.CREATE || 0}
  - Updates: ${stats.by_operation.UPDATE || 0}
  - Deletes: ${stats.by_operation.DELETE || 0}
  - Completed: ${stats.by_status.COMPLETED || 0}
  - Errors: ${stats.by_status.ERROR || 0}
`);
```

### Example 4: Cleanup Old Operations
```javascript
// In maintenance job
const tables = ['venta', 'partvta', 'canota', 'cunota', 'xcorte'];

for (const table of tables) {
  const deleted = await operationsRepository.deleteOldOperations(table, 90);
  console.log(`${table}: Deleted ${deleted} operations older than 90 days`);
}
```

---

## Testing

### Unit Test Example
```javascript
const operationsRepository = require('../repositories/operationsRepository');

// Mock the repository
jest.mock('../repositories/operationsRepository');

describe('PostgresService', () => {
  it('should log successful CREATE operation', async () => {
    operationsRepository.saveOperation.mockResolvedValue();
    
    await postgresService.saveSingleRecord(/* params */);
    
    expect(operationsRepository.saveOperation).toHaveBeenCalledWith({
      tableName: 'venta',
      operation: 'CREATE',
      status: 'COMPLETED',
      // ...
    });
  });
});
```

---

## Migration Checklist

- [x] Create OperationsRepository class
- [x] Implement all repository methods
- [x] Add operationsRepository import to PostgresService
- [x] Replace all saveToOperationsTable calls with repository
- [x] Remove saveToOperationsTable method from PostgresService
- [x] Update getRecordStatus to use repository
- [x] Add operationsRepository import to RecordStatusService
- [x] Replace checkOperationsTable with repository call
- [x] Remove checkOperationsTable method from RecordStatusService
- [x] Verify no direct _OPERATIONS queries in services
- [ ] Add unit tests for repository
- [ ] Add integration tests
- [ ] Update API documentation

---

## File Structure

```
src/
├── repositories/
│   └── operationsRepository.js  ✅ NEW - All _OPERATIONS queries
├── services/
│   ├── postgresService.js       ✅ UPDATED - Uses repository
│   └── recordStatusService.js   ✅ UPDATED - Uses repository
```

---

## Notes

- Repository uses singleton pattern (exported as instance)
- All methods handle errors gracefully (log and return null/empty)
- Connection pooling managed by pgPool
- Queries use parameterized statements (SQL injection safe)
- JSONB fields automatically stringified
- Consistent field truncation for VARCHAR limits
