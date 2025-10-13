const express = require('express');
const queue = require('../workers/batchWorker');
const logger = require('../utils/logger'); // ← Nuevo

class ItemsRoute {
  constructor(app) {
    this.app = app;
    this.registerRoutes();
  }

  registerRoutes() {
    this.app.post('/items', this.createItem.bind(this));
  }

  async createItem(req, res) {
    try {
      const { operation, records, table_name, client_id, field_id } = req.body;
      
      // ... validaciones existentes ...
      
      const job = await queue.add('process_batch', {
        operation,
        records, 
        table_name,
        client_id,
        field_id,
        received_at: new Date()
      });

      await logger.info('Nuevo batch encolado', {
        job_id: job.id,
        table: table_name,
        operation: operation,
        records_count: records.length,
        client: client_id
      });
      
      res.status(200).json({
        status: "ok",
        msg: "Batch encolado exitosamente",
        status_id: "BATCH_QUEUED",
        id_cola: job.id,
        status_code: 200
      });
      
    } catch (error) {
      await logger.error('Error encolando batch', {
        error: error.message,
        table: req.body.table_name
      });
      
      res.status(200).json({
        status: "error",
        msg: `Error al encolar batch: ${error.message}`,
        status_id: "QUEUE_ERROR",
        id_cola: null,
        status_code: 200
      });
    }
  }
}

module.exports = ItemsRoute;