const { Pool } = require('pg');
const DBConfig = require('./dbConfig');

class PostgresConfig extends DBConfig {
  async connect() {
    this.pool = new Pool({
      host: this.host,
      port: this.port,
      database: this.database,
      user: this.username,
      password: this.password,
      max: this.poolSize,
    });
    return this.pool;
  }
}

module.exports = PostgresConfig;
