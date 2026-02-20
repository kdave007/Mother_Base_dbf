const pgPool = require('../db/database');

class SyncLogsService {
  constructor() {
    this.pool = pgPool;
  }

  async insertSyncLog(syncData) {
    const {
      client_id,
      task,
      version,
      batch_version,
      date_from,
      date_to,
      total_records,
      completed_records,
      pending_records,
      error_records,
      sync_percentage,
      latest_failed_batches = 0,
      latest_failed_batch_rec = 0
    } = syncData;

    if (!client_id) {
      throw new Error('client_id es requerido');
    }

    if (!task) {
      throw new Error('task es requerido');
    }

    if (!version) {
      throw new Error('version es requerido');
    }

    if (!batch_version) {
      throw new Error('batch_version es requerido');
    }

    const truncatedClientId = String(client_id).substring(0, 100);
    const truncatedTask = String(task).substring(0, 50);
    const truncatedVersion = String(version).substring(0, 20);
    const truncatedBatchVersion = String(batch_version).substring(0, 50);

    const query = `
      INSERT INTO client_sync_logs (
        client_id,
        task,
        version,
        batch_version,
        date_from,
        date_to,
        total_records,
        completed_records,
        pending_records,
        error_records,
        sync_percentage,
        latest_failed_batches,
        latest_failed_batch_rec,
        created_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')
      )
      ON CONFLICT (client_id)
      DO UPDATE SET
        task = EXCLUDED.task,
        version = EXCLUDED.version,
        batch_version = EXCLUDED.batch_version,
        date_from = EXCLUDED.date_from,
        date_to = EXCLUDED.date_to,
        total_records = EXCLUDED.total_records,
        completed_records = EXCLUDED.completed_records,
        pending_records = EXCLUDED.pending_records,
        error_records = EXCLUDED.error_records,
        sync_percentage = EXCLUDED.sync_percentage,
        latest_failed_batches = EXCLUDED.latest_failed_batches,
        latest_failed_batch_rec = EXCLUDED.latest_failed_batch_rec,
        created_at = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        truncatedClientId,
        truncatedTask,
        truncatedVersion,
        truncatedBatchVersion,
        date_from,
        date_to,
        total_records,
        completed_records,
        pending_records,
        error_records,
        sync_percentage,
        latest_failed_batches,
        latest_failed_batch_rec
      ]);

      return {
        success: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error inserting sync log:', error);
      throw error;
    }
  }

  async getSyncLog(clientId) {
    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    const truncatedClientId = String(clientId).substring(0, 100);

    const query = `
      SELECT *
      FROM client_sync_logs
      WHERE client_id = $1
    `;

    try {
      const result = await this.pool.query(query, [truncatedClientId]);

      if (result.rows.length === 0) {
        return {
          found: false,
          message: 'Sync log no encontrado para este cliente'
        };
      }

      return {
        found: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error getting sync log:', error);
      throw error;
    }
  }

  async getAllSyncLogs() {
    const query = `
      SELECT *
      FROM client_sync_logs
      ORDER BY created_at DESC
    `;

    try {
      const result = await this.pool.query(query);

      return {
        success: true,
        count: result.rows.length,
        data: result.rows
      };
    } catch (error) {
      console.error('Error getting all sync logs:', error);
      throw error;
    }
  }

  async deleteSyncLog(clientId) {
    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    const truncatedClientId = String(clientId).substring(0, 100);

    const query = `
      DELETE FROM client_sync_logs
      WHERE client_id = $1
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [truncatedClientId]);

      if (result.rows.length === 0) {
        return {
          success: false,
          message: 'Sync log no encontrado para este cliente'
        };
      }

      return {
        success: true,
        message: 'Sync log eliminado exitosamente',
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error deleting sync log:', error);
      throw error;
    }
  }
}

module.exports = new SyncLogsService();
