const pgPool = require('../db/database');
const TypeMapper = require('./typeMapper');

class PostgresService {
  constructor() {
    this.typeMapper = new TypeMapper();
  }

  /**
   * Normaliza un valor para garantizar que nunca se procesen arreglos como [null].
   * Convierte undefined, '' (cadena vacía), o [null] a null.
   * @param {*} value - El valor a normalizar
   * @returns {*} - El valor normalizado
   */
  normalizeValue(value) {
    // Si es undefined o cadena vacía, retornar null
    if (value === undefined || value === '') {
      return null;
    }

    // Si es un arreglo con un solo elemento null, retornar null
    if (Array.isArray(value) && value.length === 1 && value[0] === null) {
      return null;
    }

    // Retornar el valor tal cual
    return value;
  }

  async saveRecords(records, tableName, clientId, fieldId, operation, tableSchema, job_id, ver) {
    const client = await pgPool.connect();
    const results = [];
    
    try {
      // Intentar procesamiento por lotes primero
      if (operation === 'create') {
        return await this.batchInsert(client, records, tableName, clientId, fieldId, tableSchema, ver);
      } 
      else if (operation === 'update') {
        return await this.batchUpdate(client, records, tableName, clientId, fieldId, tableSchema, ver);
      }
      else if (operation === 'delete') {
        return await this.batchDelete(client, records, tableName, clientId, fieldId, ver);
      }
      
      return results;
      
    } finally {
      client.release();
    }
  }

  /**
   * Procesa registros individualmente (fallback cuando falla el batch)
   */
  async processSingleRecords(client, records, tableName, clientId, fieldId, operation, tableSchema, ver) {
    const results = [];
    
    for (const record of records) {
      try {
        let result;
        
        if (operation === 'create') {
          result = await this.saveSingleRecord(
            client, record, tableName, clientId, fieldId, tableSchema, ver
          );
        } 
        else if (operation === 'update') {
          result = await this.updateSingleRecord(
            client, record, tableName, clientId, fieldId, tableSchema, ver
          );
        }
        else if (operation === 'delete') {
          result = await this.deleteSingleRecord(
            client, record, tableName, clientId, fieldId, tableSchema, ver
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
          recordData: record,
          ver
        });
        
        results.push({
          record_id: record.__meta?.[fieldId],
          status: 'error',
          error: recordError.message
        });
      }
    }
    
    return results;
  }
  
  /**
   * INSERT por lotes usando multi-value INSERT
   */
  async batchInsert(client, records, tableName, clientId, fieldId, tableSchema, ver) {
    if (records.length === 0) return [];

    try {
      // Preparar datos para todos los registros
      const allColumns = new Set();
      const recordsData = [];

      // Primera pasada: recolectar todas las columnas y preparar datos
      for (const record of records) {
        const { __meta, ...dbfFields } = record;
        const recordColumns = [];
        const recordValues = [];

        // Procesar campos DBF
        for (const [fieldName, stringValue] of Object.entries(dbfFields)) {
          const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
          const normalizedValue = this.normalizeValue(stringValue);
          const convertedValue = this.typeMapper.convertValue(normalizedValue, fieldMetadata);
          
          const colName = fieldName.toLowerCase();
          allColumns.add(colName);
          recordColumns.push(colName);
          recordValues.push(convertedValue);
        }

        // Procesar metadata
        if (__meta) {
          for (const [key, value] of Object.entries(__meta)) {
            if (key !== 'recno' && key !== 'ref_date') {
              const colName = `_${key}`;
              allColumns.add(colName);
              recordColumns.push(colName);
              recordValues.push(String(value));
            }
          }
        }

        // Agregar campos comunes
        allColumns.add('_client_id');
        recordColumns.push('_client_id');
        recordValues.push(clientId);

        const plaza = clientId && clientId.includes('_') ? clientId.split('_')[0] : clientId;
        allColumns.add('plaza');
        recordColumns.push('plaza');
        recordValues.push(plaza);

        if (ver) {
          allColumns.add('_ver');
          recordColumns.push('_ver');
          recordValues.push(ver);
        }

        recordsData.push({
          record,
          columns: recordColumns,
          values: recordValues,
          recordId: __meta?.[fieldId]
        });
      }

      // Convertir Set a Array para orden consistente
      const columnsList = Array.from(allColumns);

      // Construir query con múltiples VALUES
      const valueClauses = [];
      const allValues = [];
      let paramCount = 1;

      for (const { columns, values } of recordsData) {
        const placeholders = [];
        
        // Para cada columna en columnsList, agregar el valor correspondiente o NULL
        for (const col of columnsList) {
          const idx = columns.indexOf(col);
          if (idx !== -1) {
            placeholders.push(`$${paramCount}`);
            allValues.push(values[idx]);
            paramCount++;
          } else {
            placeholders.push('NULL');
          }
        }
        
        valueClauses.push(`(${placeholders.join(', ')})`);
      }

      const query = `
        INSERT INTO ${tableName.toLowerCase()} 
        (${columnsList.join(', ')})
        VALUES ${valueClauses.join(',\n        ')}
        RETURNING _${fieldId}
      `;

      const result = await client.query(query, allValues);

      // Mapear resultados
      return recordsData.map((data, idx) => ({
        record_id: data.recordId,
        status: 'success',
        postgres_id: result.rows[idx]?.[`_${fieldId}`]
      }));

    } catch (batchError) {
      console.error('Error en batch INSERT, fallback a procesamiento individual:', batchError.message);
      // Fallback: procesar uno por uno
      return await this.processSingleRecords(client, records, tableName, clientId, fieldId, 'create', tableSchema, ver);
    }
  }

  /**
   * UPDATE por lotes usando CASE statements
   */
  async batchUpdate(client, records, tableName, clientId, fieldId, tableSchema, ver) {
    if (records.length === 0) return [];

    try {
      // Recolectar todos los campos que se van a actualizar
      const allFieldsToUpdate = new Set();
      const recordsData = [];

      for (const record of records) {
        const { __meta, ...dbfFields } = record;
        const recordId = __meta?.[fieldId];
        
        if (!recordId) {
          throw new Error(`ID no proporcionado para UPDATE (field_id: ${fieldId})`);
        }

        const updateFields = {};

        // Campos DBF
        for (const [fieldName, stringValue] of Object.entries(dbfFields)) {
          const normalizedValue = this.normalizeValue(stringValue);
          if (normalizedValue === null) continue;
          
          const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
          const convertedValue = this.typeMapper.convertValue(normalizedValue, fieldMetadata);
          
          const colName = fieldName.toLowerCase();
          allFieldsToUpdate.add(colName);
          updateFields[colName] = convertedValue;
        }

        // Metadata
        if (__meta) {
          for (const [key, value] of Object.entries(__meta)) {
            if (key !== 'recno' && key !== fieldId && key !== 'ref_date') {
              const colName = `_${key}`;
              allFieldsToUpdate.add(colName);
              updateFields[colName] = String(value);
            }
          }
        }

        recordsData.push({ recordId, updateFields });
      }

      if (allFieldsToUpdate.size === 0) {
        throw new Error('No hay campos para actualizar en el batch');
      }

      // Construir CASE statements para cada campo
      const setClauses = [];
      const allValues = [];
      let paramCount = 1;

      for (const fieldName of allFieldsToUpdate) {
        let caseStatement = `${fieldName} = CASE _${fieldId}`;
        
        for (const { recordId, updateFields } of recordsData) {
          if (updateFields[fieldName] !== undefined) {
            caseStatement += ` WHEN $${paramCount} THEN $${paramCount + 1}`;
            allValues.push(recordId, updateFields[fieldName]);
            paramCount += 2;
          }
        }
        
        caseStatement += ` ELSE ${fieldName} END`;
        setClauses.push(caseStatement);
      }

      // Agregar timestamp
      setClauses.push('_updated_at = CURRENT_TIMESTAMP');

      // IDs para WHERE IN
      const recordIds = recordsData.map(r => r.recordId);
      const inPlaceholders = recordIds.map((_, idx) => `$${paramCount + idx}`).join(', ');
      allValues.push(...recordIds);
      paramCount += recordIds.length;

      // Client ID y version
      allValues.push(clientId, ver);

      const query = `
        UPDATE ${tableName.toLowerCase()} 
        SET ${setClauses.join(',\n            ')}
        WHERE _${fieldId} IN (${inPlaceholders})
          AND _client_id = $${paramCount}
          AND _ver = $${paramCount + 1}
        RETURNING _${fieldId}, _updated_at
      `;

      const result = await client.query(query, allValues);

      // Verificar que todos los registros se actualizaron
      const updatedIds = new Set(result.rows.map(r => r[`_${fieldId}`]));
      const results = [];

      for (const { recordId } of recordsData) {
        if (updatedIds.has(recordId)) {
          results.push({
            record_id: recordId,
            status: 'success',
            postgres_id: recordId
          });
        } else {
          results.push({
            record_id: recordId,
            status: 'error',
            error: 'Registro no encontrado para UPDATE'
          });
        }
      }

      return results;

    } catch (batchError) {
      console.error('Error en batch UPDATE, fallback a procesamiento individual:', batchError.message);
      return await this.processSingleRecords(client, records, tableName, clientId, fieldId, 'update', tableSchema, ver);
    }
  }

  /**
   * DELETE por lotes usando WHERE IN
   */
  async batchDelete(client, records, tableName, clientId, fieldId, ver) {
    if (records.length === 0) return [];

    try {
      const recordIds = [];
      const recordIdMap = new Map();

      for (const record of records) {
        const { __meta } = record;
        const recordId = __meta?.[fieldId];
        
        if (!recordId) {
          throw new Error(`ID no proporcionado para DELETE (field_id: ${fieldId})`);
        }

        recordIds.push(recordId);
        recordIdMap.set(recordId, record);
      }

      // Construir query con WHERE IN
      const placeholders = recordIds.map((_, idx) => `$${idx + 1}`).join(', ');
      const values = [...recordIds, clientId, ver];

      const query = `
        DELETE FROM ${tableName.toLowerCase()} 
        WHERE _${fieldId} IN (${placeholders})
          AND _client_id = $${recordIds.length + 1}
          AND _ver = $${recordIds.length + 2}
        RETURNING _${fieldId}
      `;

      const result = await client.query(query, values);

      // Verificar qué registros se eliminaron
      const deletedIds = new Set(result.rows.map(r => r[`_${fieldId}`]));
      const results = [];

      for (const recordId of recordIds) {
        if (deletedIds.has(recordId)) {
          results.push({
            record_id: recordId,
            status: 'success',
            postgres_id: recordId
          });
        } else {
          results.push({
            record_id: recordId,
            status: 'error',
            error: 'Registro no encontrado para DELETE'
          });
        }
      }

      return results;

    } catch (batchError) {
      console.error('Error en batch DELETE, fallback a procesamiento individual:', batchError.message);
      return await this.processSingleRecords(client, records, tableName, clientId, fieldId, 'delete', tableSchema, ver);
    }
  }

  async saveSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver) {
    const { __meta, ...dbfFields } = record;
    
    const columns = [];
    const values = [];
    const placeholders = [];
    let paramCount = 1;
    
    // Campos DBF
    for (const [fieldName, stringValue] of Object.entries(dbfFields)) {
      const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
      const normalizedValue = this.normalizeValue(stringValue);
      const convertedValue = this.typeMapper.convertValue(normalizedValue, fieldMetadata);
      
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
    paramCount++;
    
    // Agregar _ver si está presente
    if (ver) {
      columns.push('_ver');
      values.push(ver);
      placeholders.push(`$${paramCount}`);
    }
    
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

  async updateSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver) {
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
      const normalizedValue = this.normalizeValue(stringValue);
      if (normalizedValue === null) continue;
      
      const fieldMetadata = tableSchema?.find(f => f.name === fieldName);
      const convertedValue = this.typeMapper.convertValue(normalizedValue, fieldMetadata);
      
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
    paramCount++;
    
    values.push(clientId);
    paramCount++;
    
    values.push(ver);
    
    const query = `
      UPDATE ${tableName.toLowerCase()} 
      SET ${setClauses.join(', ')}
      WHERE _${fieldId} = $${paramCount - 2}
        AND _client_id = $${paramCount - 1}
        AND _ver = $${paramCount}
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

  async deleteSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver) {
    const { __meta } = record;
    
    const recordId = __meta?.[fieldId];
    if (!recordId) {
      throw new Error(`ID no proporcionado para DELETE (field_id: ${fieldId})`);
    }
    
    const query = `
      DELETE FROM ${tableName.toLowerCase()} 
      WHERE _${fieldId} = $1
        AND _client_id = $2
        AND _ver = $3
      RETURNING _${fieldId}
    `;
    
    const result = await client.query(query, [recordId, clientId, ver]);
    
    if (result.rows.length === 0) {
      throw new Error(`Registro no encontrado para DELETE (_${fieldId}: ${recordId})`);
    }
    
    return {
      record_id: recordId,
      status: 'success',
      postgres_id: result.rows[0]?.[`_${fieldId}`]
    };
  }


  async saveToErrorTable({ tableName, recordId, clientId, operation, error, fieldId, recordData, ver }) {
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
        (record_id, client_id, operation, error_type, error_message, field_id, record_data, ver, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (record_id, client_id, ver) 
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
        recordData ? JSON.stringify(recordData) : null,
        ver
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