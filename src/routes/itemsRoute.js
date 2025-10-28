

const express = require('express');
const queue = require('../workers/batchWorker');
const logger = require('../utils/logger'); 
const authMiddleware = require('../middleware/auth');
const recordStatusService = require('../services/recordStatusService');

class ItemsRoute {
  constructor(app) {
    this.app = app;
    this.registerRoutes();
  }

  registerRoutes() {
    this.app.post('/items', authMiddleware, this.createItem.bind(this));
    this.app.post('/records', authMiddleware, this.getRecords.bind(this));
  }

  async createItem(req, res) {
    try {
      console.log('🔍 Headers:', req.headers['content-type']);
      console.log('🔍 Body type:', typeof req.body);

      let operation, records, table_name, client_id, field_id, ver;

      // ✅ DETECTAR SI ES NDJSON
      if (req.headers['content-type'] === 'text/plain') {
        console.log('📦 Procesando NDJSON en ItemsRoute...');
        
        // Parsear NDJSON
        const lines = req.body.trim().split('\n');
        records = lines.map(line => {
          try {
            return JSON.parse(line);
          } catch (parseError) {
            throw {
              message: `Error parseando línea NDJSON: ${parseError.message}`,
              statusCode: 400, // Bad Request
              code: 'INVALID_NDJSON'
            };
          }
        });
        
        // Obtener metadata del query
        operation = req.query.operation;
        table_name = req.query.table_name;
        client_id = req.query.client_id;
        field_id = req.query.field_id;
        ver = req.query.ver;

        console.log(`✅ NDJSON parseado: ${records.length} registros para ${client_id}`);
      } else {
        // JSON TRADICIONAL
        console.log('📦 Procesando JSON tradicional...');
        ({ operation, records, table_name, client_id, field_id, ver } = req.body);
      }

      console.log('1️⃣ Parseo completado');

      // ✅ VALIDACIONES BÁSICAS CON CÓDIGOS HTTP APROPIADOS
      if (!operation) {
        throw {
          message: 'Operation es requerido',
          statusCode: 400, // Bad Request
          code: 'MISSING_OPERATION'
        };
      }
      
      if (!records || !Array.isArray(records)) {
        throw {
          message: 'Records debe ser un array no vacío',
          statusCode: 400, // Bad Request
          code: 'INVALID_RECORDS'
        };
      }

      if (records.length === 0) {
        throw {
          message: 'Records no puede estar vacío',
          statusCode: 400, // Bad Request
          code: 'EMPTY_RECORDS'
        };
      }

      if (!table_name) {
        throw {
          message: 'Table_name es requerido',
          statusCode: 400, // Bad Request
          code: 'MISSING_TABLE_NAME'
        };
      }

      console.log('2️⃣ Validaciones pasadas');

      // ✅ ENCOLAR EN REDIS
      console.log('3️⃣ Intentando encolar en Redis...');
      
      const job = await Promise.race([
        queue.add('process_batch', {
          operation,
          records, 
          table_name,
          client_id,
          field_id,
          ver,
          received_at: new Date()
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject({
            message: 'Timeout encolando en Redis',
            statusCode: 503, // Service Unavailable
            code: 'REDIS_TIMEOUT'
          }), 5000)
        )
      ]);

      console.log('4️⃣ Encolado exitoso, job ID:', job.id);

      // ✅ RESPUESTA DE ÉXITO
      const response = {
        status: "ok",
        msg: "Batch encolado exitosamente", 
        status_id: "BATCH_QUEUED",
        id_cola: job.id,
        status_code: 200
      };

      console.log('5️⃣ Enviando respuesta...');
      res.status(200).json(response);
      console.log('6️⃣ Respuesta enviada');

    } catch (error) {
      console.error('❌ ERROR en createItem:', error.message);
      
      // ✅ DETERMINAR CÓDIGO HTTP APROPIADO
      const statusCode = error.statusCode || 500; // Default: Internal Server Error
      const errorCode = error.code || 'INTERNAL_ERROR';
      
      const errorResponse = {
        status: "error",
        msg: error.message,
        status_id: errorCode, 
        id_cola: null,
        status_code: statusCode
      };

      // ✅ LOGGING DIFERENCIADO POR TIPO DE ERROR
      if (statusCode >= 500) {
        await logger.error('Error interno en createItem', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.query?.client_id || req.body?.client_id
        });
      } else {
        await logger.warn('Error del cliente en createItem', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.query?.client_id || req.body?.client_id
        });
      }

      res.status(statusCode).json(errorResponse);
      console.log(`✅ Respuesta de error enviada (${statusCode})`);
    }
  }

  async getRecords(req, res) {
    try {
      console.log('🔍 [RECORDS] Headers:', req.headers['content-type']);
      console.log('🔍 [RECORDS] Query params:', req.query);

      // ✅ EXTRAER PARÁMETROS DEL QUERY
      const { table, ver, field_id, client_id } = req.query;

      // ✅ VALIDAR PARÁMETROS REQUERIDOS
      if (!table) {
        throw {
          message: 'table es requerido',
          statusCode: 400,
          code: 'MISSING_TABLE'
        };
      }

      if (!field_id) {
        throw {
          message: 'field_id es requerido',
          statusCode: 400,
          code: 'MISSING_FIELD_ID'
        };
      }

      if (!client_id) {
        throw {
          message: 'client_id es requerido',
          statusCode: 400,
          code: 'MISSING_CLIENT_ID'
        };
      }

      // ✅ PARSEAR NDJSON DEL BODY
      let recordRequests = [];
      
      if (req.headers['content-type'] === 'text/plain') {
        console.log('📦 [RECORDS] Procesando NDJSON...');
        
        const lines = req.body.trim().split('\n');
        recordRequests = lines.map((line, index) => {
          try {
            const parsed = JSON.parse(line);
            
            // Validar que tenga el field_id dinámico e id_cola
            if (!parsed[field_id]) {
              throw new Error(`Línea ${index + 1}: ${field_id} es requerido`);
            }
            if (!parsed.id_cola) {
              throw new Error(`Línea ${index + 1}: id_cola es requerido`);
            }
            
            return parsed;
          } catch (parseError) {
            throw {
              message: `Error parseando línea ${index + 1} NDJSON: ${parseError.message}`,
              statusCode: 400,
              code: 'INVALID_NDJSON'
            };
          }
        });

        console.log(`✅ [RECORDS] NDJSON parseado: ${recordRequests.length} registros`);
      } else {
        throw {
          message: 'Content-Type debe ser text/plain para NDJSON',
          statusCode: 400,
          code: 'INVALID_CONTENT_TYPE'
        };
      }

      // ✅ VALIDAR QUE HAYA REGISTROS
      if (recordRequests.length === 0) {
        throw {
          message: 'No se enviaron registros para consultar',
          statusCode: 400,
          code: 'EMPTY_RECORDS'
        };
      }

      console.log('✅ [RECORDS] Validaciones pasadas');
      console.log('📊 [RECORDS] Datos recibidos:', {
        table,
        ver,
        field_id,
        client_id,
        records_count: recordRequests.length
      });

      // ✅ CONSULTAR ESTADO DE LOS REGISTROS
      console.log('🔍 [RECORDS] Consultando estado de registros...');
      
      const statusResults = await recordStatusService.checkRecordsStatus(
        table,
        field_id,
        recordRequests,
        client_id,
        ver
      );

      console.log('✅ [RECORDS] Consulta completada');
      console.log('📊 [RECORDS] Resultados:', {
        total: statusResults.total_records,
        completed: statusResults.records.filter(r => r.status === 'COMPLETED').length,
        errors: statusResults.records.filter(r => r.status === 'ERROR').length,
        not_found: statusResults.records.filter(r => r.status === 'NOT_FOUND').length
      });

      res.status(200).json(statusResults);
      console.log('✅ [RECORDS] Respuesta enviada');

    } catch (error) {
      console.error('❌ [RECORDS] ERROR:', error.message);
      
      const statusCode = error.statusCode || 500;
      const errorCode = error.code || 'INTERNAL_ERROR';
      
      const errorResponse = {
        status: "error",
        msg: error.message,
        status_id: errorCode,
        status_code: statusCode
      };

      if (statusCode >= 500) {
        await logger.error('Error interno en getRecords', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.query?.client_id
        });
      } else {
        await logger.warn('Error del cliente en getRecords', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.query?.client_id
        });
      }

      res.status(statusCode).json(errorResponse);
      console.log(`✅ [RECORDS] Respuesta de error enviada (${statusCode})`);
    }
  }
}

module.exports = ItemsRoute;