const pgPool = require('../db/database');

async function testPostgresConnection() {
  try {
    const client = await pgPool.connect();
    
    // Consulta simple para verificar conexión
    const result = await client.query('SELECT version(), current_database() as database');
    
    client.release();
    
    return {
      success: true,
      message: 'PostgreSQL conectado correctamente',
      version: result.rows[0].version,
      database: result.rows[0].database,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  testPostgresConnection
};