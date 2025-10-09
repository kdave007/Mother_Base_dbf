class DBConfig {
  constructor(host, port, database, username, password, poolSize = 10) {
    this.host = host;
    this.port = port;
    this.database = database;
    this.username = username;
    this.password = password;
    this.poolSize = poolSize;
    this.pool = null; // This will hold the connection pool
  }

  async connect() {
    throw new Error('connect method must be implemented by subclass');
  }

  async getConnection() {
    if (!this.pool) {
      this.pool = await this.connect();
    }
    return this.pool.acquire();
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.drain();
      await this.pool.clear();
    }
  }
}

module.exports = DBConfig;
