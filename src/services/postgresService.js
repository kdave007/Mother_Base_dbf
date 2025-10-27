const pgPool = require('../db/database');
const TypeMapper = require('./typeMapper');

class PostgresService {
  constructor() {
    this.typeMapper = new TypeMapper();
  }

  async saveRecords(records, tableName, clientId, fieldId, operation, tableSchema, job_id) {
    const client = await pgPool.connect();
    const results = [];
    
    try {
      // Procesar cada registro de forma independiente (sin transacción ni savepoints)
      for (const record of records) {
        try {
          let result;
          
          if (operation === 'create') {
            result = await this.saveSingleRecord(
              client, record, tableName, clientId, fieldId, tableSchema
            );
          } 
          else if (operation === 'update') {
            result = await this.updateSingleRecord(
              client, record, tableName, clientId, fieldId, tableSchema
            );
          }
          else if (operation === 'delete') {
            result = await this.deleteSingleRecord(
              client, record, tableName, clientId, fieldId, tableSchema
            );
          }
          
          results.push(result);
          
        } catch (recordError) {
          // Guardar error en tabla de errores
          await this.saveToErrorTable({
            tableName,
            recordId: record.__meta?.[fieldId],
            clientId,
            operation,
            error: recordError,
            fieldId,
            recordData: record
          });
          
          results.push({
            record_id: record.__meta?.[fieldId],
            status: 'error',
            error: recordError.message
          });
        }
      }
      
      return results;
      
    } finally {
      client.release();
    }
  }
  
  async saveSingleRecord(client, record, tableName, clientId, fieldId, tableSchema) {
    const { __meta, ...dbfFields } = record;
    
    const columns = [];
    const values = [];
    const placeholders = [];
    let paramCount = 1;
    
    // Campos DBF
    for (const [fieldName, stringValue] of Object.entries(dbfFields)) {
      const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
      const convertedValue = this.typeMapper.convertValue(stringValue, fieldMetadata);
      
      columns.push(fieldName.toLowerCase());
      values.push(convertedValue);
      placeholders.push(`$${paramCount}`);
      paramCount++;
    }
    
    // Metadata de __meta
    if (__meta) {
      for (const [key, value] of Object.entries(__meta)) {
        if (key !== 'recno' && key !== 'ref_date') {
          columns.push(`_${key}`);
          values.push(String(value));
          placeholders.push(`$${paramCount}`);
          paramCount++;
        }
      }
    }
    
    columns.push('_client_id');
    values.push(clientId);
    placeholders.push(`$${paramCount}`);
    paramCount++;

    let plaza = clientId && clientId.includes('_') ? clientId.split('_')[0] : clientId; 
    columns.push('plaza');
    values.push(plaza);
    placeholders.push(`$${paramCount}`);
    
    const query = `
      INSERT INTO ${tableName.toLowerCase()} 
      (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING _${fieldId}
    `;
    
    const result = await client.query(query, values);
    
    return {
      record_id: __meta?.[fieldId],
      status: 'success',
      postgres_id: result.rows[0]?.[`_${fieldId}`]
    };
  }

  async updateSingleRecord(client, record, tableName, clientId, fieldId, tableSchema) {
    const { __meta, ...dbfFields } = record;
    
    const recordId = __meta?.[fieldId];
    if (!recordId) {
      throw new Error(`ID no proporcionado para UPDATE (field_id: ${fieldId})`);
    }
    
    const setClauses = [];
    const values = [];
    let paramCount = 1;
    
    // Campos DBF a actualizar (ignorar vacíos)
    for (const [fieldName, stringValue] of Object.entries(dbfFields)) {
      if (stringValue === '' || stringValue === null || stringValue === undefined) continue;
      
      const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
      const convertedValue = this.typeMapper.convertValue(stringValue, fieldMetadata);
      
      setClauses.push(`${fieldName.toLowerCase()} = $${paramCount}`);
      values.push(convertedValue);
      paramCount++;
    }
    
    // Metadata de __meta a actualizar
    if (__meta) {
      for (const [key, value] of Object.entries(__meta)) {
        if (key !== 'recno' && key !== fieldId && key !== 'ref_date') {
          setClauses.push(`_${key} = $${paramCount}`);
          values.push(String(value));
          paramCount++;
        }
      }
    }
    
    // Actualizar timestamp
    setClauses.push('_updated_at = CURRENT_TIMESTAMP');
    
    if (setClauses.length === 0) {
      throw new Error('No hay campos para actualizar');
    }
    
    values.push(recordId);
    
    const query = `
      UPDATE ${tableName.toLowerCase()} 
      SET ${setClauses.join(', ')}
      WHERE _${fieldId} = $${paramCount}
      RETURNING _${fieldId}, _updated_at
    `;
    
    const result = await client.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error(`Registro no encontrado para UPDATE (_${fieldId}: ${recordId})`);
    }
    
    return {
      record_id: recordId,
      status: 'success',
      postgres_id: result.rows[0]?.[`_${fieldId}`]
    };
  }

  async deleteSingleRecord(client, record, tableName, clientId, fieldId, tableSchema) {
    const { __meta } = record;
    
    const recordId = __meta?.[fieldId];
    if (!recordId) {
      throw new Error(`ID no proporcionado para DELETE (field_id: ${fieldId})`);
    }
    
    const query = `
      DELETE FROM ${tableName.toLowerCase()} 
      WHERE _${fieldId} = $1
      RETURNING _${fieldId}
    `;
    
    const result = await client.query(query, [recordId]);
    
    if (result.rows.length === 0) {
      throw new Error(`Registro no encontrado para DELETE (_${fieldId}: ${recordId})`);
    }
    
    return {
      record_id: recordId,
      status: 'success',
      postgres_id: result.rows[0]?.[`_${fieldId}`]
    };
  }


  async saveToErrorTable({ tableName, recordId, clientId, operation, error, fieldId, recordData }) {
    /**
     * use this method to insert or update on conflict errors when trying to make an operation to the main tables
     * this error table has the table name + errors, like, canota_errors, cunota_errors, xcorte_errors 
     * with this structrue :
     * - recordId
      - clientId  
      - operation
      - error
      - fieldId
      - recordData (opcional)
     * 
     */
    
    const client = await pgPool.connect();
    
    try {
      const errorTableName = `${tableName.toLowerCase()}_errors`;
      const errorMessage = error.message || String(error);
      const errorType = error.name || 'Error';
      
      // Truncar valores para ajustarse a los límites de la tabla
      const truncatedClientId = clientId ? String(clientId).substring(0, 50) : null;
      const truncatedOperation = operation ? String(operation).substring(0, 20) : null;
      const truncatedErrorType = errorType.substring(0, 50);
      const truncatedFieldId = fieldId ? String(fieldId).substring(0, 50) : null;
      
      const query = `
        INSERT INTO ${errorTableName} 
        (record_id, client_id, operation, error_type, error_message, field_id, record_data, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (record_id, client_id) 
        DO UPDATE SET 
          operation = EXCLUDED.operation,
          error_type = EXCLUDED.error_type,
          error_message = EXCLUDED.error_message,
          field_id = EXCLUDED.field_id,
          record_data = EXCLUDED.record_data,
          created_at = CURRENT_TIMESTAMP
      `;
      
      await client.query(query, [
        recordId,
        truncatedClientId,
        truncatedOperation,
        truncatedErrorType,
        errorMessage,
        truncatedFieldId,
        recordData ? JSON.stringify(recordData) : null
      ]);
      
    } catch (saveError) {
      console.error('Error al guardar en tabla de errores:', saveError);
      // No lanzamos el error para no interrumpir el flujo principal
    } finally {
      client.release();
    }
  }


}

module.exports = new PostgresService();