const crypto = require('crypto');
const redisClient = require('../config/redisClient');
const pgPool = require('../db/database');

let apiKeyService = null;

const initializeAuthMiddleware = async () => {
  const ApiKeyService = require('../services/apiKeyService');
  apiKeyService = new ApiKeyService(pgPool);
  await apiKeyService.loadApiKeysToCache();
  return apiKeyService;
};

const authMiddleware = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  
  if (!apiKey) {
    return res.status(401).json({
      status: "error",
      msg: "API Key requerida",
      status_id: "MISSING_API_KEY"
    });
  }

  if (!apiKeyService) {
    return res.status(500).json({
      status: "error",
      msg: "Authentication service not initialized",
      status_id: "SERVICE_NOT_INITIALIZED"
    });
  }

  try {
    const result = await apiKeyService.validateApiKey(apiKey);
    
    if (!result.valid) {
      return res.status(401).json({
        status: "error",
        msg: "API Key inválida",
        status_id: "INVALID_API_KEY"
      });
    }

    req.client = { client_id: result.client_id };
    next();
  } catch (error) {
    console.error('Error validating API key:', error);
    return res.status(500).json({
      status: "error",
      msg: "Error validating API key",
      status_id: "VALIDATION_ERROR"
    });
  }
};

module.exports = authMiddleware;
module.exports.initializeAuthMiddleware = initializeAuthMiddleware;