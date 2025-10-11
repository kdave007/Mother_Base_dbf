const { Pool } = require('pg');

const pgPool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'shadow_moses',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
});

module.exports = pgPool;