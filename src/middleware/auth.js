const API_KEYS = {
    'ARAUC_XALAP': process.env.ARAUC_XALAP_API_KEY || 'LWDSDxN2tH',
    'ROTON_XALAP': process.env.ROTON_XALAP_API_KEY || '42YiabP2Tf',
    'CIRCU_XALAP': process.env.CIRCU_XALAP_API_KEY || 'UNU9S4LY99',
    'XJALC_XALAP': process.env.XJALC_XALAP_API_KEY || 'Cz6cLkQgeC',
    'BRUNO_XALAP': process.env.BRUNO_XALAP_API_KEY || 'YWvLe1X5CU',
    'REVOL_XALAP': process.env.REVOL_XALAP_API_KEY || '79yxH4FGcl',
    'XMART_XALAP': process.env.XMART_XALAP_API_KEY || '8DfvrDJNER',
    'ATENA_XALAP': process.env.ATENA_XALAP_API_KEY || '8TXfvrDJNER',
    'REBSA_XALAP': process.env.REBSA_XALAP_API_KEY || 'O4TfvrDJNER',
    'CARRI_XALAP': process.env.REBSA_XALAP_API_KEY || 'DxN2tHrDJER',
    'COAT1_XALAP': process.env.REBSA_XALAP_API_KEY || '9S4LYrDJNER',
  };
  
  const authMiddleware = (req, res, next) => {
    const apiKey = req.header('X-API-Key');
    
    if (!apiKey) {
      return res.status(401).json({
        status: "error",
        msg: "API Key requerida",
        status_id: "MISSING_API_KEY"
      });
    }
  
    // Buscar qué client_id tiene esta API Key
    const client_id = Object.keys(API_KEYS).find(key => API_KEYS[key] === apiKey);
    
    if (!client_id) {
      return res.status(401).json({
        status: "error",
        msg: "API Key inválida",
        status_id: "INVALID_API_KEY"
      });
    }
  
    req.client = { client_id };
    next();
  };
  
  module.exports = authMiddleware;