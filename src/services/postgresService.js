const pgPool = require('../db/database');
const TypeMapper = require('./typeMapper');
const operationsRepository = require('../repositories/operationsRepository');

class PostgresService {
  constructor() {
    this.typeMapper = new TypeMapper();
  }

  /**
   * Detecta si un error es de tipo duplicado (unique constraint violation)
   */
  isDuplicateError(error) {
    if (!error) return false;
    const errorMsg = (error.message || '').toLowerCase();
    const errorCode = error.code;
    return errorCode === '23505' || 
           errorMsg.includes('duplicate') || 
           errorMsg.includes('unique constraint') ||
           errorMsg.includes('already exists');
  }

  /**
   * Detecta si un error es de tipo "no encontrado" en operaciones DELETE
   */
  isNotFoundError(error, operation) {
    if (!error || operation !== 'delete') return false;
    const errorMsg = (error.message || '').toLowerCase();
    return errorMsg.includes('no encontrado') || 
           errorMsg.includes('not found') ||
           errorMsg.includes('no existe') ||
           errorMsg.includes('0 rows') ||
           errorMsg.includes('does not exist');
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
        return await this.batchInsert(client, records, tableName, clientId, fieldId, tableSchema, ver, job_id);
      } 
      else if (operation === 'update') {
        return await this.batchUpdate(client, records, tableName, clientId, fieldId, tableSchema, ver, job_id);
      }
      else if (operation === 'delete') {
        return await this.batchDelete(client, records, tableName, clientId, fieldId, ver, job_id);
      }
      
      return results;
      
    } finally {
      client.release();
    }
  }

  /**
   * Procesa registros individualmente (fallback cuando falla el batch)
   */
  async processSingleRecords(client, records, tableName, clientId, fieldId, operation, tableSchema, ver, job_id) {
    const results = [];
    
    for (const record of records) {
      try {
        let result;
        
        if (operation === 'create') {
          result = await this.saveSingleRecord(
            client, record, tableName, clientId, fieldId, tableSchema, ver, job_id
          );
        } 
        else if (operation === 'update') {
          result = await this.updateSingleRecord(
            client, record, tableName, clientId, fieldId, tableSchema, ver, job_id
          );
        }
        else if (operation === 'delete') {
          result = await this.deleteSingleRecord(
            client, record, tableName, clientId, fieldId, tableSchema, ver, job_id
          );
        }
        
        results.push(result);
        
      } catch (recordError) {
        const recordId = record.__meta?.[fieldId];
        
        // Determinar si es un caso especial (bypass)
        const isDuplicate = this.isDuplicateError(recordError) && operation === 'create';
        const isNotFound = this.isNotFoundError(recordError, operation);
        const isSpecialCase = isDuplicate || isNotFound;
        
        // Guardar en tabla de operaciones
        await operationsRepository.saveOperation({
          tableName,
          recordId,
          clientId,
          operation,
          status: isSpecialCase ? 'COMPLETED' : 'ERROR',
          error: isSpecialCase ? { message: isDuplicate ? 'Duplicate bypassed' : 'Delete not found bypassed' } : recordError,
          fieldId,
          inputData: record,
          batchVersion: ver,
          batchId: job_id
        });
        
        // Si es un caso especial, reportar como éxito
        if (isSpecialCase) {
          results.push({
            record_id: recordId,
            status: 'success',
            note: isDuplicate ? 'Duplicate bypassed' : 'Delete not found bypassed'
          });
        } else {
          results.push({
            record_id: recordId,
            status: 'error',
            error: recordError.message
          });
        }
      }
    }
    
    return results;
  }
  
  /**
   * INSERT por lotes usando multi-value INSERT
   */
  async batchInsert(client, records, tableName, clientId, fieldId, tableSchema, ver, job_id) {
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

      // Registrar operaciones exitosas en _OPERATIONS
      const results = [];
      for (let idx = 0; idx < recordsData.length; idx++) {
        const data = recordsData[idx];
        const postgresId = result.rows[idx]?.[`_${fieldId}`];
        
        // Guardar operación exitosa
        await operationsRepository.saveOperation({
          tableName,
          recordId: data.recordId,
          clientId,
          operation: 'CREATE',
          status: 'COMPLETED',
          fieldId,
          inputData: data.record,
          batchVersion: ver,
          batchId: job_id
        });
        
        results.push({
          record_id: data.recordId,
          status: 'success',
          postgres_id: postgresId
        });
      }
      
      return results;

    } catch (batchError) {
      console.error('Error en batch INSERT, fallback a procesamiento individual:', batchError.message);
      // Fallback: procesar uno por uno
      return await this.processSingleRecords(client, records, tableName, clientId, fieldId, 'create', tableSchema, ver, job_id);
    }
  }

  /**
   * UPDATE por lotes usando CASE statements
   */
  async batchUpdate(client, records, tableName, clientId, fieldId, tableSchema, ver, job_id) {
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

      for (const { recordId, updateFields } of recordsData) {
        const record = records.find(r => r.__meta?.[fieldId] === recordId);
        
        if (updatedIds.has(recordId)) {
          // Registro actualizado exitosamente
          await operationsRepository.saveOperation({
            tableName,
            recordId,
            clientId,
            operation: 'UPDATE',
            status: 'COMPLETED',
            fieldId,
            inputData: record,
            batchVersion: ver,
            batchId: job_id
          });
          
          results.push({
            record_id: recordId,
            status: 'success',
            postgres_id: recordId
          });
        } else {
          // Registro no encontrado - registrar como ERROR
          await operationsRepository.saveOperation({
            tableName,
            recordId,
            clientId,
            operation: 'UPDATE',
            status: 'ERROR',
            error: { message: 'Registro no encontrado para UPDATE' },
            fieldId,
            inputData: record,
            batchVersion: ver,
            batchId: job_id
          });
          
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
      return await this.processSingleRecords(client, records, tableName, clientId, fieldId, 'update', tableSchema, ver, job_id);
    }
  }

  /**
   * DELETE por lotes usando WHERE IN
   */
  async batchDelete(client, records, tableName, clientId, fieldId, ver, job_id) {
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
        const record = recordIdMap.get(recordId);
        
        if (deletedIds.has(recordId)) {
          // Registro eliminado exitosamente
          await operationsRepository.saveOperation({
            tableName,
            recordId,
            clientId,
            operation: 'DELETE',
            status: 'COMPLETED',
            fieldId,
            inputData: record,
            batchVersion: ver,
            batchId: job_id
          });
          
          results.push({
            record_id: recordId,
            status: 'success',
            postgres_id: recordId
          });
        } else {
          // Registro no encontrado - caso especial (bypass)
          await operationsRepository.saveOperation({
            tableName,
            recordId,
            clientId,
            operation: 'DELETE',
            status: 'COMPLETED',
            error: { message: 'Delete not found bypassed' },
            fieldId,
            inputData: record,
            batchVersion: ver,
            batchId: job_id
          });
          
          results.push({
            record_id: recordId,
            status: 'success',
            note: 'Delete not found bypassed'
          });
        }
      }

      return results;

    } catch (batchError) {
      console.error('Error en batch DELETE, fallback a procesamiento individual:', batchError.message);
      return await this.processSingleRecords(client, records, tableName, clientId, fieldId, 'delete', tableSchema, ver, job_id);
    }
  }

  async saveSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver, job_id) {
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
    const postgresId = result.rows[0]?.[`_${fieldId}`];
    const recordId = __meta?.[fieldId];
    
    // Registrar operación exitosa
    await operationsRepository.saveOperation({
      tableName,
      recordId,
      clientId,
      operation: 'CREATE',
      status: 'COMPLETED',
      fieldId,
      inputData: record,
      batchVersion: ver,
      batchId: job_id
    });
    
    return {
      record_id: recordId,
      status: 'success',
      postgres_id: postgresId
    };
  }

  async updateSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver, job_id) {
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
    
    // Registrar operación exitosa
    await operationsRepository.saveOperation({
      tableName,
      recordId,
      clientId,
      operation: 'UPDATE',
      status: 'COMPLETED',
      fieldId,
      inputData: record,
      batchVersion: ver,
      batchId: job_id
    });
    
    return {
      record_id: recordId,
      status: 'success',
      postgres_id: result.rows[0]?.[`_${fieldId}`]
    };
  }

  async deleteSingleRecord(client, record, tableName, clientId, fieldId, tableSchema, ver, job_id) {
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
    
    // Registrar operación exitosa
    await operationsRepository.saveOperation({
      tableName,
      recordId,
      clientId,
      operation: 'DELETE',
      status: 'COMPLETED',
      fieldId,
      inputData: record,
      batchVersion: ver,
      batchId: job_id
    });
    
    return {
      record_id: recordId,
      status: 'success',
      postgres_id: result.rows[0]?.[`_${fieldId}`]
    };
  }


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
    const client = await pgPool.connect();
    
    try {
      // 1. PRIMERO: Buscar en tabla de operaciones (fuente de verdad)
      const op = await operationsRepository.findOperationByRecord(tableName, recordId, clientId, ver);
      
      if (op) {
        const { operation, status, error_message } = op;
        
        // QUEUED o PROCESSING → Status: PROCESSING
        if (status === 'QUEUED' || status === 'PROCESSING') {
          return {
            record_id: recordId,
            status: 'PROCESSING',
            source: 'operations_table',
            note: `Operation ${operation} is ${status}`,
            data: null
          };
        }
        
        // ERROR → Status: ERROR (excepto casos especiales)
        if (status === 'ERROR') {
          // Verificar si es un caso especial que debe reportarse como COMPLETED
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
            return {
              record_id: recordId,
              status: 'COMPLETED',
              source: 'operations_table',
              note: isDuplicateBypass ? 'Duplicate bypassed' : 'Delete not found bypassed',
              data: null
            };
          } else {
            // Error real
            return {
              record_id: recordId,
              status: 'ERROR',
              source: 'operations_table',
              error_message: error_message,
              data: null
            };
          }
        }
        
        // COMPLETED → Verificar en tabla principal para obtener datos
        if (status === 'COMPLETED') {
          // Para DELETE COMPLETED, no buscar en tabla principal
          if (operation === 'DELETE') {
            return {
              record_id: recordId,
              status: 'COMPLETED',
              source: 'operations_table',
              note: 'Record was deleted',
              data: null
            };
          } else {
            // Para CREATE/UPDATE COMPLETED, verificar tabla principal y validar consistencia
            const mainTableQuery = `
              SELECT _${fieldId}, _server_id, _ver, _deleted
              FROM ${tableName.toLowerCase()}
              WHERE _${fieldId} = $1 
                AND _client_id = $2
                AND _ver = $3
              LIMIT 1
            `;
            
            const mainResult = await client.query(mainTableQuery, [recordId, clientId, ver]);
            
            if (mainResult.rows.length === 0) {
              // INCONSISTENCIA DETECTADA: marcado como COMPLETED pero no existe
              return {
                record_id: recordId,
                status: 'ERROR',
                source: 'operations_table',
                error_message: `Operation ${operation} marked as COMPLETED but record not found in main table. Possible causes: manual deletion, transaction rollback, or database inconsistency.`,
                data: null
              };
            } else {
              // COMPLETED VÁLIDO: operación exitosa y registro existe
              return {
                record_id: recordId,
                status: 'COMPLETED',
                source: 'operations_table',
                data: mainResult.rows[0]
              };
            }
          }
        }
        
        // Cualquier otro status
        return {
          record_id: recordId,
          status: 'NOT_FOUND',
          source: 'operations_table',
          note: `Unknown operation status: ${status}`,
          data: null
        };
      }
      
      // 2. SEGUNDO: Si no hay operación registrada, buscar en tabla principal
      const mainTableQuery = `
        SELECT _${fieldId}, _server_id, _ver, _deleted
        FROM ${tableName.toLowerCase()}
        WHERE _${fieldId} = $1 
          AND _client_id = $2
          AND _ver = $3
        LIMIT 1
      `;
      
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
      
    } finally {
      client.release();
    }
  }



}

module.exports = new PostgresService();