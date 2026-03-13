const pgPool = require('../db/database');

class SpotGroupService {
  constructor() {
    this.pool = pgPool;
  }

  async getByGroupId(groupId) {
    if (!groupId) {
      throw new Error('group_id es requerido');
    }

    const truncatedGroupId = String(groupId).substring(0, 100);

    const query = `
      SELECT 
        group_id,
        client_id,
        api_key,
        added_at AT TIME ZONE 'America/Mexico_City' as added_at,
        active
      FROM spot_group
      WHERE group_id = $1
      ORDER BY added_at DESC
    `;

    try {
      const result = await this.pool.query(query, [truncatedGroupId]);

      if (result.rows.length === 0) {
        return {
          found: false,
          message: 'No se encontraron registros para este group_id'
        };
      }

      return {
        found: true,
        count: result.rows.length,
        data: result.rows
      };
    } catch (error) {
      console.error('Error getting spot group by group_id:', error);
      throw error;
    }
  }

  async getByGroupIdAndClientId(groupId, clientId) {
    if (!groupId) {
      throw new Error('group_id es requerido');
    }

    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    const truncatedGroupId = String(groupId).substring(0, 100);
    const truncatedClientId = String(clientId).substring(0, 100);

    const query = `
      SELECT 
        group_id,
        client_id,
        api_key,
        added_at AT TIME ZONE 'America/Mexico_City' as added_at,
        active
      FROM spot_group
      WHERE group_id = $1 AND client_id = $2
    `;

    try {
      const result = await this.pool.query(query, [truncatedGroupId, truncatedClientId]);

      if (result.rows.length === 0) {
        return {
          found: false,
          message: 'No se encontró el registro para este group_id y client_id'
        };
      }

      return {
        found: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error getting spot group by group_id and client_id:', error);
      throw error;
    }
  }

  async getByClientId(clientId) {
    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    const truncatedClientId = String(clientId).substring(0, 100);

    const query = `
      SELECT 
        group_id,
        client_id,
        api_key,
        added_at AT TIME ZONE 'America/Mexico_City' as added_at,
        active
      FROM spot_group
      WHERE client_id = $1
      ORDER BY added_at DESC
    `;

    try {
      const result = await this.pool.query(query, [truncatedClientId]);

      if (result.rows.length === 0) {
        return {
          found: false,
          message: 'No se encontraron registros para este client_id'
        };
      }

      return {
        found: true,
        count: result.rows.length,
        data: result.rows
      };
    } catch (error) {
      console.error('Error getting spot group by client_id:', error);
      throw error;
    }
  }

  async getActiveByGroupId(groupId) {
    if (!groupId) {
      throw new Error('group_id es requerido');
    }

    const truncatedGroupId = String(groupId).substring(0, 100);

    const query = `
      SELECT 
        group_id,
        client_id,
        api_key,
        added_at AT TIME ZONE 'America/Mexico_City' as added_at,
        active
      FROM spot_group
      WHERE group_id = $1 AND active = TRUE
      ORDER BY added_at DESC
    `;

    try {
      const result = await this.pool.query(query, [truncatedGroupId]);

      if (result.rows.length === 0) {
        return {
          found: false,
          message: 'No se encontraron registros activos para este group_id'
        };
      }

      return {
        found: true,
        count: result.rows.length,
        data: result.rows
      };
    } catch (error) {
      console.error('Error getting active spot group by group_id:', error);
      throw error;
    }
  }

  async insertSpotGroup(groupData) {
    const { group_id, client_id, api_key, active = true } = groupData;

    if (!group_id) {
      throw new Error('group_id es requerido');
    }

    if (!client_id) {
      throw new Error('client_id es requerido');
    }

    if (!api_key) {
      throw new Error('api_key es requerido');
    }

    const truncatedGroupId = String(group_id).substring(0, 100);
    const truncatedClientId = String(client_id).substring(0, 100);
    const truncatedApiKey = String(api_key).substring(0, 100);

    const query = `
      INSERT INTO spot_group (group_id, client_id, api_key, added_at, active)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
      ON CONFLICT (group_id, client_id)
      DO UPDATE SET
        api_key = EXCLUDED.api_key,
        active = EXCLUDED.active,
        added_at = CURRENT_TIMESTAMP
      RETURNING 
        group_id,
        client_id,
        api_key,
        added_at AT TIME ZONE 'America/Mexico_City' as added_at,
        active
    `;

    try {
      const result = await this.pool.query(query, [
        truncatedGroupId,
        truncatedClientId,
        truncatedApiKey,
        active
      ]);

      return {
        success: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error inserting spot group:', error);
      throw error;
    }
  }

  async updateActive(groupId, clientId, active) {
    if (!groupId) {
      throw new Error('group_id es requerido');
    }

    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    if (typeof active !== 'boolean') {
      throw new Error('active debe ser un valor booleano');
    }

    const truncatedGroupId = String(groupId).substring(0, 100);
    const truncatedClientId = String(clientId).substring(0, 100);

    const query = `
      UPDATE spot_group
      SET active = $3
      WHERE group_id = $1 AND client_id = $2
      RETURNING 
        group_id,
        client_id,
        api_key,
        added_at AT TIME ZONE 'America/Mexico_City' as added_at,
        active
    `;

    try {
      const result = await this.pool.query(query, [truncatedGroupId, truncatedClientId, active]);

      if (result.rows.length === 0) {
        return {
          success: false,
          message: 'No se encontró el registro para actualizar'
        };
      }

      return {
        success: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error updating spot group active status:', error);
      throw error;
    }
  }

  async deleteSpotGroup(groupId, clientId) {
    if (!groupId) {
      throw new Error('group_id es requerido');
    }

    if (!clientId) {
      throw new Error('client_id es requerido');
    }

    const truncatedGroupId = String(groupId).substring(0, 100);
    const truncatedClientId = String(clientId).substring(0, 100);

    const query = `
      DELETE FROM spot_group
      WHERE group_id = $1 AND client_id = $2
      RETURNING 
        group_id,
        client_id,
        api_key,
        added_at AT TIME ZONE 'America/Mexico_City' as added_at,
        active
    `;

    try {
      const result = await this.pool.query(query, [truncatedGroupId, truncatedClientId]);

      if (result.rows.length === 0) {
        return {
          success: false,
          message: 'No se encontró el registro para eliminar'
        };
      }

      return {
        success: true,
        message: 'Registro eliminado exitosamente',
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Error deleting spot group:', error);
      throw error;
    }
  }
}

module.exports = new SpotGroupService();
