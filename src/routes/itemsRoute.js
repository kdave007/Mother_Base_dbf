const express = require('express');
const queue = require('../workers/batchWorker');
const logger = require('../utils/logger'); 
const authMiddleware = require('../middleware/auth');
const recordStatusService = require('../services/recordStatusService');
const settingsService = require('../services/settingsService');
const activityService = require('../services/activityService');
const syncLogsService = require('../services/syncLogsService');
const spotGroupService = require('../services/spotGroupService');

const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_JOBS_PER_CLIENT = 20;
const RATE_LIMIT_RELAXED_MAX_JOBS_PER_CLIENT = 100;
const QUEUE_WAIT_THRESHOLD = 200;
const clientRateLimits = new Map();

class ItemsRoute {
  constructor(app) {
    this.app = app;
    this.registerRoutes();
  }

  registerRoutes() {
    this.app.post('/items', authMiddleware, this.createItem.bind(this));
    this.app.post('/records', authMiddleware, this.getRecords.bind(this));
    this.app.post('/settings', authMiddleware, this.getSettings.bind(this));
    // this.app.post('/activity', authMiddleware, this.updateActivity.bind(this));
    this.app.post('/activity', authMiddleware, this.receiveMetrics.bind(this));
    this.app.post('/spot-group', authMiddleware, this.getSpotGroup.bind(this));
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

      let effectiveMaxJobsPerClient = RATE_LIMIT_RELAXED_MAX_JOBS_PER_CLIENT;
      try {
        const counts = await queue.getJobCounts();
        const waitCount = counts.waiting || 0;
        if (waitCount > QUEUE_WAIT_THRESHOLD) {
          effectiveMaxJobsPerClient = RATE_LIMIT_MAX_JOBS_PER_CLIENT;
        }
      } catch (e) {
        await logger.warn('No se pudo obtener jobCounts de Bull para rate limit', {
          error: e.message
        });
      }

      if (client_id) {
        const now = Date.now();
        let info = clientRateLimits.get(client_id);
        if (!info || now - info.windowStart >= RATE_LIMIT_WINDOW_MS) {
          info = { windowStart: now, count: 0 };
        }
        info.count += 1;
        clientRateLimits.set(client_id, info);

        if (info.count > effectiveMaxJobsPerClient) {
          throw {
            message: 'Rate limit excedido para este cliente. Intenta más tarde.',
            statusCode: 429,
            code: 'RATE_LIMIT_EXCEEDED'
          };
        }
      }

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
        }, {
          removeOnComplete: true,
          removeOnFail: true
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
      const startTime = Date.now();

      const statusResults = await recordStatusService.checkRecordsStatus(
        table,
        field_id,
        recordRequests,
        client_id,
        ver
      );

      const durationMs = Date.now() - startTime;
      console.log(`⏱️ [RECORDS] Consulta de estado completada en ${durationMs} ms`);

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

  async getSettings(req, res) {
    try {
      console.log('⚙️ [SETTINGS] Headers:', req.headers['content-type']);
      console.log('⚙️ [SETTINGS] Body:', req.body);

      // ✅ VALIDAR QUE SEA JSON
      if (req.headers['content-type'] !== 'application/json') {
        throw {
          message: 'Content-Type debe ser application/json',
          statusCode: 400,
          code: 'INVALID_CONTENT_TYPE'
        };
      }

      // ✅ EXTRAER client_id DEL BODY
      const { client_id } = req.body;

      // ✅ VALIDAR client_id
      if (!client_id) {
        throw {
          message: 'client_id es requerido',
          statusCode: 400,
          code: 'MISSING_CLIENT_ID'
        };
      }

      console.log('✅ [SETTINGS] Validaciones pasadas');
      console.log('📊 [SETTINGS] client_id recibido:', client_id);

      // ✅ OBTENER SETTINGS DEL CLIENTE
      console.log('🔍 [SETTINGS] Consultando settings en base de datos...');
      const settingsResult = await settingsService.getClientSettings(client_id);

      if (!settingsResult.found) {
        throw {
          message: settingsResult.message,
          statusCode: 404,
          code: 'SETTINGS_NOT_FOUND'
        };
      }

      console.log('✅ [SETTINGS] Settings encontrados:', settingsResult.count);

      const response = {
        status: "ok",
        msg: "Settings obtenidos exitosamente",
        status_id: "SETTINGS_OK",
        client_id: settingsResult.client_id,
        settings: settingsResult.settings,
        count: settingsResult.count,
        status_code: 200
      };

      res.status(200).json(response);
      console.log('✅ [SETTINGS] Respuesta enviada');

    } catch (error) {
      console.error('❌ [SETTINGS] ERROR:', error.message);
      
      const statusCode = error.statusCode || 500;
      const errorCode = error.code || 'INTERNAL_ERROR';
      
      const errorResponse = {
        status: "error",
        msg: error.message,
        status_id: errorCode,
        status_code: statusCode
      };

      if (statusCode >= 500) {
        await logger.error('Error interno en getSettings', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.body?.client_id
        });
      } else {
        await logger.warn('Error del cliente en getSettings', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.body?.client_id
        });
      }

      res.status(statusCode).json(errorResponse);
      console.log(`✅ [SETTINGS] Respuesta de error enviada (${statusCode})`);
    }
  }

  async updateActivity(req, res) {
    try {
      console.log('📝 [ACTIVITY] Headers:', req.headers['content-type']);
      console.log('📝 [ACTIVITY] Body:', req.body);

      if (req.headers['content-type'] !== 'application/json') {
        throw {
          message: 'Content-Type debe ser application/json',
          statusCode: 400,
          code: 'INVALID_CONTENT_TYPE'
        };
      }

      const { client_id, task } = req.body;

      if (!client_id) {
        throw {
          message: 'client_id es requerido',
          statusCode: 400,
          code: 'MISSING_CLIENT_ID'
        };
      }

      console.log('✅ [ACTIVITY] Validaciones pasadas');
      console.log('📊 [ACTIVITY] Datos:', { client_id, task });

      console.log('💾 [ACTIVITY] Actualizando en base de datos (Mexico City timezone)...');
      
      const result = await activityService.updateClientActivity(client_id, task);

      console.log('✅ [ACTIVITY] Actividad actualizada exitosamente');

      const response = {
        status: "ok",
        msg: "Actividad actualizada exitosamente",
        status_id: "ACTIVITY_UPDATED",
        client_id: result.client_id,
        last_seen: result.last_seen,
        task: result.task,
        status_code: 200
      };

      res.status(200).json(response);
      console.log('✅ [ACTIVITY] Respuesta enviada');

    } catch (error) {
      console.error('❌ [ACTIVITY] ERROR:', error.message);
      
      const statusCode = error.statusCode || 500;
      const errorCode = error.code || 'INTERNAL_ERROR';
      
      const errorResponse = {
        status: "error",
        msg: error.message,
        status_id: errorCode,
        status_code: statusCode
      };

      if (statusCode >= 500) {
        await logger.error('Error interno en updateActivity', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.body?.client_id
        });
      } else {
        await logger.warn('Error del cliente en updateActivity', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.body?.client_id
        });
      }

      res.status(statusCode).json(errorResponse);
      console.log(`✅ [ACTIVITY] Respuesta de error enviada (${statusCode})`);
    }
  }

  async receiveMetrics(req, res) {
    try {
      console.log('📊 [METRICS] Headers:', req.headers['content-type']);
      console.log('📊 [METRICS] Body:', req.body);

      if (req.headers['content-type'] !== 'application/json') {
        throw {
          message: 'Content-Type debe ser application/json',
          statusCode: 400,
          code: 'INVALID_CONTENT_TYPE'
        };
      }

      const { client_id, task, details } = req.body;

      if (!client_id) {
        throw {
          message: 'client_id es requerido',
          statusCode: 400,
          code: 'MISSING_CLIENT_ID'
        };
      }

      if (!task) {
        throw {
          message: 'task es requerido',
          statusCode: 400,
          code: 'MISSING_TASK'
        };
      }

      console.log('✅ [METRICS] Validaciones pasadas');
      console.log('📊 [METRICS] Datos recibidos:', { 
        client_id, 
        task,
        has_details: !!details 
      });

      console.log('💾 [METRICS] Guardando actividad en base de datos...');
      
      const activityResult = await activityService.updateClientActivity(client_id, task);

      console.log('✅ [METRICS] Actividad guardada exitosamente');

      let syncLogResult = null;
      if (details && details.sync_summary) {
        console.log('💾 [METRICS] Guardando sync log...');
        
        const syncData = {
          client_id: client_id,
          task: task,
          version: details.version || 'unknown',
          batch_version: details.batch_version || 'unknown',
          date_from: details.date_range?.from || null,
          date_to: details.date_range?.to || null,
          total_records: details.sync_summary.total_records || 0,
          completed_records: details.sync_summary.completed || 0,
          pending_records: details.sync_summary.pending || 0,
          error_records: details.sync_summary.errors || 0,
          sync_percentage: details.sync_summary.sync_percentage || 0,
          latest_failed_batches: details.sync_summary.failed_batches || 0,
          latest_failed_batch_rec: details.sync_summary.failed_batch_records || 0
        };

        syncLogResult = await syncLogsService.insertSyncLog(syncData);
        console.log('✅ [METRICS] Sync log guardado exitosamente');
      }

      const response = {
        status: "ok",
        msg: "Métricas recibidas y guardadas exitosamente",
        status_id: "METRICS_RECEIVED",
        client_id: activityResult.client_id,
        task: activityResult.task,
        last_seen: activityResult.last_seen,
        sync_log_saved: !!syncLogResult,
        status_code: 200
      };

      res.status(200).json(response);
      console.log('✅ [METRICS] Respuesta enviada');

    } catch (error) {
      console.error('❌ [METRICS] ERROR:', error.message);
      
      const statusCode = error.statusCode || 500;
      const errorCode = error.code || 'INTERNAL_ERROR';
      
      const errorResponse = {
        status: "error",
        msg: error.message,
        status_id: errorCode,
        status_code: statusCode
      };

      if (statusCode >= 500) {
        await logger.error('Error interno en receiveMetrics', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.body?.client_id
        });
      } else {
        await logger.warn('Error del cliente en receiveMetrics', {
          error: error.message,
          code: errorCode,
          statusCode: statusCode,
          client: req.body?.client_id
        });
      }

      res.status(statusCode).json(errorResponse);
      console.log(`✅ [METRICS] Respuesta de error enviada (${statusCode})`);
    }
  }

  async getSpotGroup(req, res) {
    try {
      console.log('🔍 [CLIENTS] Headers:', req.headers['content-type']);
      console.log('🔍 [CLIENTS] Body:', req.body);

      if (req.headers['content-type'] !== 'application/json') {
        return res.status(400).json({
          error: 'Content-Type must be application/json'
        });
      }

      const { group_id } = req.body;

      if (!group_id) {
        return res.status(400).json({
          error: 'group_id is required'
        });
      }

      console.log('✅ [CLIENTS] Validaciones pasadas');
      console.log('📊 [CLIENTS] group_id recibido:', group_id);

      console.log('🔍 [CLIENTS] Consultando clientes en base de datos...');
      const spotGroupResult = await spotGroupService.getActiveByGroupId(group_id);

      if (!spotGroupResult.found) {
        return res.status(404).json({
          error: 'Group not found or has no active clients'
        });
      }

      console.log('✅ [CLIENTS] Clientes encontrados:', spotGroupResult.count);

      const clients = spotGroupResult.data.map(item => ({
        client_id: item.client_id,
        api_key: item.api_key
      }));

      const response = {
        group_id: group_id,
        group_name: group_id,
        clients: clients
      };

      res.status(200).json(response);
      console.log('✅ [CLIENTS] Respuesta enviada');

    } catch (error) {
      console.error('❌ [CLIENTS] ERROR:', error.message);
      
      await logger.error('Error interno en getSpotGroup', {
        error: error.message,
        group_id: req.body?.group_id
      });

      res.status(500).json({
        error: 'Internal server error'
      });
      console.log(`✅ [CLIENTS] Respuesta de error enviada (500)`);
    }
  }
}

module.exports = ItemsRoute;