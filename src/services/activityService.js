const pgPool = require('../db/database');

class ActivityService {
  constructor() {
    this.pool = pgPool;
  }

  async updateClientActivity(clientId, task = null) {
    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    // Truncate client_id to fit varchar(50) constraint
    const truncatedClientId = String(clientId).substring(0, 50);
    const taskValue = task ? String(task) : null;

    // Use PostgreSQL's timezone conversion to Mexico City time
    // AT TIME ZONE converts the timestamp to the specified timezone
    const query = `
      INSERT INTO client_activity (client_id, last_seen, created_at, task)
      VALUES (
        $1, 
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City'),
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City'),
        $2
      )
      ON CONFLICT (client_id) 
      DO UPDATE SET 
        last_seen = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City'),
        task = EXCLUDED.task
      RETURNING client_id, last_seen, task
    `;

    try {
      const result = await this.pool.query(query, [truncatedClientId, taskValue]);
      
      return {
        success: true,
        client_id: result.rows[0].client_id,
        last_seen: result.rows[0].last_seen,
        task: result.rows[0].task
      };
    } catch (error) {
      console.error('Error updating client activity:', error);
      throw error;
    }
  }

  async getClientActivity(clientId) {
    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    const truncatedClientId = String(clientId).substring(0, 50);

    const query = `
      SELECT client_id, last_seen, created_at, task
      FROM client_activity
      WHERE client_id = $1
    `;

    try {
      const result = await this.pool.query(query, [truncatedClientId]);
      
      if (result.rows.length === 0) {
        return {
          found: false,
          message: 'Cliente no encontrado'
        };
      }

      return {
        found: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error getting client activity:', error);
      throw error;
    }
  }
}

module.exports = new ActivityService();
