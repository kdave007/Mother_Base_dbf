const crypto = require('crypto');
const redisClient = require('../config/redisClient');

class ApiKeyService {
  constructor(postgresPool) {
    this.pool = postgresPool;
    this.CACHE_PREFIX = 'api_key:';
    this.CACHE_TTL = 3600;
  }

  hashApiKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  async loadApiKeysToCache() {
    try {
      const redis = redisClient.getClient();
      const result = await this.pool.query(
        'SELECT client_id, api_key_hash FROM client_api_keys WHERE is_active = true'
      );

      if (result.rows.length === 0) {
        console.warn('No active API keys found in database');
        return 0;
      }

      const pipeline = redis.pipeline();
      
      for (const row of result.rows) {
        const cacheKey = `${this.CACHE_PREFIX}${row.api_key_hash}`;
        pipeline.setex(cacheKey, this.CACHE_TTL, row.client_id);
      }

      await pipeline.exec();
      console.log(`Loaded ${result.rows.length} API keys to Redis cache`);
  
      return result.rows.length;
    } catch (error) {
      console.error('Error loading API keys to cache:', error);
      throw error;
    }
  }

  async validateApiKey(apiKey) {
    try {
      const hashedKey = this.hashApiKey(apiKey);
      const redis = redisClient.getClient();
      const cacheKey = `${this.CACHE_PREFIX}${hashedKey}`;

      let clientId = await redis.get(cacheKey);

      if (clientId) {
        return { valid: true, client_id: clientId };
      }

      const result = await this.pool.query(
        'SELECT client_id FROM client_api_keys WHERE api_key_hash = $1 AND is_active = true',
        [hashedKey]
      );

      if (result.rows.length === 0) {
        return { valid: false, client_id: null };
      }

      clientId = result.rows[0].client_id;
      await redis.setex(cacheKey, this.CACHE_TTL, clientId);

      return { valid: true, client_id: clientId };
    } catch (error) {
      console.error('Error validating API key:', error);
      throw error;
    }
  }

  async refreshCache() {
    try {
      const redis = redisClient.getClient();
      const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
      
      if (keys.length > 0) {
        await redis.del(...keys);
      }

      return await this.loadApiKeysToCache();
    } catch (error) {
      console.error('Error refreshing cache:', error);
      throw error;
    }
  }

  async addApiKey(clientId, apiKey) {
    try {
      const hashedKey = this.hashApiKey(apiKey);
      
      await this.pool.query(
        `INSERT INTO client_api_keys (client_id, api_key_hash, is_active, updated_at) 
         VALUES ($1, $2, true, NOW()) 
         ON CONFLICT (client_id) 
         DO UPDATE SET api_key_hash = $2, updated_at = NOW(), is_active = true`,
        [clientId, hashedKey]
      );

      const redis = redisClient.getClient();
      const cacheKey = `${this.CACHE_PREFIX}${hashedKey}`;
      await redis.setex(cacheKey, this.CACHE_TTL, clientId);

      return { success: true, client_id: clientId };
    } catch (error) {
      console.error('Error adding API key:', error);
      throw error;
    }
  }

  async revokeApiKey(clientId) {
    try {
      const result = await this.pool.query(
        'UPDATE client_api_keys SET is_active = false, updated_at = NOW() WHERE client_id = $1 RETURNING api_key_hash',
        [clientId]
      );

      if (result.rows.length > 0) {
        const redis = redisClient.getClient();
        const cacheKey = `${this.CACHE_PREFIX}${result.rows[0].api_key_hash}`;
        await redis.del(cacheKey);
      }

      return { success: true, revoked: result.rows.length > 0 };
    } catch (error) {
      console.error('Error revoking API key:', error);
      throw error;
    }
  }
}

module.exports = ApiKeyService;
