const pgPool = require('../db/database');

class SettingsService {
  /**
   * Retrieve settings for a specific client_id from spot_settings table
   * @param {string} clientId - The client_id to search for
   * @returns {Promise<Object>} - Settings as key-value pairs in JSON format
   */
  async getClientSettings(clientId) {
    const client = await pgPool.connect();
    
    try {
      const query = `
        SELECT client_id, key, value
        FROM spot_settings
        WHERE client_id = $1
          AND is_active = true
        ORDER BY key ASC
      `;
      
      const result = await client.query(query, [clientId]);
      
      if (result.rows.length === 0) {
        return {
          client_id: clientId,
          settings: {},
          found: false,
          message: `No active settings found for client_id: ${clientId}`
        };
      }
      
      // Convert rows to key-value object
      const settings = {};
      result.rows.forEach(row => {
        settings[row.key] = row.value;
      });
      
      return {
        client_id: clientId,
        settings: settings,
        found: true,
        count: result.rows.length
      };
      
    } catch (error) {
      console.error('Error fetching client settings:', error);
      throw {
        message: `Database error: ${error.message}`,
        statusCode: 500,
        code: 'DATABASE_ERROR',
        originalError: error
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get a specific setting value for a client
   * @param {string} clientId - The client_id
   * @param {string} key - The setting key to retrieve
   * @returns {Promise<string|null>} - The setting value or null if not found
   */
  async getClientSetting(clientId, key) {
    const client = await pgPool.connect();
    
    try {
      const query = `
        SELECT value
        FROM spot_settings
        WHERE client_id = $1
          AND key = $2
          AND is_active = true
        LIMIT 1
      `;
      
      const result = await client.query(query, [clientId, key]);
      
      return result.rows.length > 0 ? result.rows[0].value : null;
      
    } catch (error) {
      console.error('Error fetching client setting:', error);
      throw {
        message: `Database error: ${error.message}`,
        statusCode: 500,
        code: 'DATABASE_ERROR',
        originalError: error
      };
    } finally {
      client.release();
    }
  }
}

module.exports = new SettingsService();
