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
}

module.exports = new PostgresService();