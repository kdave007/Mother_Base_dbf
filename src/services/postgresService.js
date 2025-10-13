const pgPool = require('../db/database');
const TypeMapper = require('./typeMapper');

class PostgresService {
  constructor() {
    this.typeMapper = new TypeMapper();
  }

  async saveRecords(records, tableName, clientId, fieldId, operation, tableSchema) {
    const client = await pgPool.connect();
    
    try {
      await client.query('BEGIN');
      const results = [];
      
      for (const record of records) {
        try {
          const result = await this.saveSingleRecord(
            client, record, tableName, clientId, fieldId, operation, tableSchema
          );
          results.push(result);
        } catch (recordError) {
          results.push({
            record_id: record.__meta?.[fieldId],
            status: 'error',
            error: recordError.message
          });
        }
      }
      
      await client.query('COMMIT');
      return results;
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  async saveSingleRecord(client, record, tableName, clientId, fieldId, operation, tableSchema) {
    const { __meta, ...dbfFields } = record;
    
    const columns = [];
    const values = [];
    const placeholders = [];
    let paramCount = 1;
    
    // 1. Campos DBF (convertidos al tipo correcto)
    for (const [fieldName, stringValue] of Object.entries(dbfFields)) {
      const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
      const convertedValue = this.typeMapper.convertValue(stringValue, fieldMetadata);
      
      columns.push(fieldName.toLowerCase());
      values.push(convertedValue);
      placeholders.push(`$${paramCount}`);
      paramCount++;
    }
    
    // 2. Metadata de __meta (siempre strings)
    if (__meta) {
      for (const [key, value] of Object.entries(__meta)) {
        if (key !== 'recno') {
          columns.push(`_${key}`);
          values.push(String(value)); // Metadata siempre como string
          placeholders.push(`$${paramCount}`);
          paramCount++;
        }
      }
    }
    
    // 3. Metadata del request
    columns.push('_client_id');
    values.push(clientId);
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

async saveRecords(records, tableName, clientId, fieldId, operation, tableSchema) {
  const client = await pgPool.connect();
  
  try {
    await client.query('BEGIN');
    const results = [];
    
    for (const record of records) {
      try {
        let result;
        
        if (operation === 'create') {
          result = await this.saveSingleRecord(
            client, record, tableName, clientId, fieldId, operation, tableSchema
          );
        } else if (operation === 'update') {
          result = await this.updateSingleRecord(
            client, record, tableName, clientId, fieldId, operation, tableSchema
          );
        }
        
        results.push(result);
      } catch (recordError) {
        results.push({
          record_id: record.__meta?.[fieldId],
          status: 'error',
          error: recordError.message
        });
      }
    }
    
    await client.query('COMMIT');
    return results;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async updateSingleRecord(client, record, tableName, clientId, fieldId, operation, tableSchema) {
  const { __meta, ...dbfFields } = record;
  
  // Validar que tenemos el ID para el UPDATE
  const recordId = __meta?.[fieldId];
  if (!recordId) {
    throw new Error(`ID no proporcionado para UPDATE (field_id: ${fieldId})`);
  }
  
  // Preparar campos para UPDATE
  const setClauses = [];
  const values = [];
  let paramCount = 1;
  
  // 1. Campos DBF a actualizar
  for (const [fieldName, stringValue] of Object.entries(dbfFields)) {
    const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
    const convertedValue = this.typeMapper.convertValue(stringValue, fieldMetadata);
    
    setClauses.push(`${fieldName.toLowerCase()} = $${paramCount}`);
    values.push(convertedValue);
    paramCount++;
  }
  
  // 2. Actualizar hash_comparador si viene
  if (__meta?.hash_comparador) {
    setClauses.push(`_hash_comparador = $${paramCount}`);
    values.push(__meta.hash_comparador);
    paramCount++;
  }
  
  // 3. WHERE condition usando el field_id
  setClauses.push(`_client_id = $${paramCount}`);
  values.push(clientId);
  paramCount++;
  
  // El ID va al final (para el WHERE)
  values.push(recordId);
  
  const query = `
    UPDATE ${tableName.toLowerCase()} 
    SET ${setClauses.join(', ')}
    WHERE _${fieldId} = $${paramCount}
    RETURNING _${fieldId}
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
}



module.exports = new PostgresService();