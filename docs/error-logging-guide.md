# Enhanced Error Logging Guide

## Overview
The batch worker now provides detailed error logging to help diagnose issues like UTF-8 encoding errors.

## What Gets Logged

### 1. Individual Error Details
For each failed record, the following information is logged:

```json
{
  "job_id": "428",
  "operation": "create|update|delete",
  "table": "table_name",
  "client_id": "client_identifier",
  "field_id": "id_field_name",
  "ver": "version",
  "record_id": "345973",
  "error_message": "invalid byte sequence for encoding \"UTF8\": 0x00",
  "record_data": {
    // Complete record with all fields
    "FIELD1": "value1",
    "FIELD2": "value2",
    "__meta": {
      "id_cola": "345973",
      // ... other metadata
    }
  },
  "record_meta": {
    // Just the __meta object
  },
  "dbf_fields": ["FIELD1", "FIELD2", ...],
  "encoding_issues": [
    {
      "field": "FIELD_NAME",
      "issue": "null_byte",
      "position": 15,
      "value_preview": "Some text[NULL]more text"
    }
  ]
}
```

### 2. Error Summary
After logging individual errors, a summary is provided:

```json
{
  "job_id": "428",
  "operation": "create",
  "table": "table_name",
  "error_count": 5,
  "error_types": {
    "encoding_error": {
      "count": 3,
      "sample_error": "invalid byte sequence for encoding \"UTF8\": 0x00",
      "record_ids": ["345973", "345974", "345975"]
    },
    "duplicate_key": {
      "count": 2,
      "sample_error": "duplicate key value violates unique constraint",
      "record_ids": ["345976", "345977"]
    }
  }
}
```

## Encoding Issue Detection

The system automatically detects:

1. **Null Bytes (0x00)**: Characters that PostgreSQL UTF-8 encoding cannot handle
   - Shows the field name
   - Shows the position of the null byte
   - Shows a preview with `[NULL]` markers

2. **Invalid UTF-8 Sequences**: Characters that don't form valid UTF-8
   - Shows the field name
   - Shows a preview of the problematic value

3. **Encoding Errors**: Any other encoding-related issues
   - Shows the field name
   - Shows the error message

## Error Type Classification

Errors are automatically grouped by type:
- `encoding_error`: UTF-8 encoding issues
- `duplicate_key`: Duplicate primary/unique key violations
- `foreign_key_violation`: Foreign key constraint violations
- `not_found`: Record not found for UPDATE/DELETE
- `null_constraint`: NULL value in NOT NULL column
- `other`: Any other errors

## How to Use This Information

### For UTF-8 Encoding Errors:

1. Look at the `encoding_issues` array to find which field has the problem
2. Check the `value_preview` to see the problematic content
3. The `position` tells you where in the string the null byte appears
4. Use the complete `record_data` to see all field values

### Example Fix:

If you see:
```json
"encoding_issues": [
  {
    "field": "NOMBRE",
    "issue": "null_byte",
    "position": 10,
    "value_preview": "Juan Pérez[NULL]"
  }
]
```

You need to sanitize the `NOMBRE` field before inserting. You can:
- Strip null bytes: `value.replace(/\0/g, '')`
- Replace with space: `value.replace(/\0/g, ' ')`
- Truncate at null byte: `value.split('\0')[0]`

## Next Steps

Consider adding automatic sanitization in the `TypeMapper` or `DbfProcessor` to handle these issues before they reach the database.
