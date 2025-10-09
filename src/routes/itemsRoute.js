const DbfProcessor = require('../processors/DbfProcessor');
const PostgresConfig = require('../db/postgresConfig');

class ItemsRoute {
  constructor(app) {
    this.app = app;
    // Initialize the database configuration
    // TODO: Get these from environment variables
    this.dbConfig = new PostgresConfig(
      process.env.DB_HOST || 'localhost',
      parseInt(process.env.DB_PORT) || 5432,
      process.env.DB_NAME || 'mydatabase',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASSWORD || ''
    );
    this.dbConfig.connect();
    this.registerRoutes();
  }

  async createItem(req, res) {
    const payload = req.body;
    const processor = new DbfProcessor(payload);
    const processedRecords = processor.process();

    if (processedRecords.length === 0) {
      return res.status(400).json({ error: 'No records to process' });
    }

    const tableName = processedRecords[0].__meta.table_name;

    try {
      const client = await this.dbConfig.getConnection();
      try {
        await client.query('BEGIN');

        for (const record of processedRecords) {
          const { __meta, ...recordData } = record;
          const columns = Object.keys(recordData).map(key => key.toLowerCase());
          const values = Object.values(recordData);
          const placeholders = columns.map((_, i) => `$${i+1}`).join(',');

          const query = {
            text: `INSERT INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`,
            values: values,
          };
          await client.query(query);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: `${processedRecords.length} records inserted into ${tableName}` });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error inserting records:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  updateItem(req, res) {
    const id = req.params.id;
    const item = req.body;
    // TODO: Add logic to update the item by id
    res.json({ message: `Item ${id} updated`, item });
  }

  deleteItem(req, res) {
    const id = req.params.id;
    // TODO: Add logic to delete the item by id
    res.json({ message: `Item ${id} deleted` });
  }

  registerRoutes() {
    this.app.post('/items', this.createItem.bind(this));
    this.app.put('/items/:id', this.updateItem.bind(this));
    this.app.delete('/items/:id', this.deleteItem.bind(this));
  }
}

module.exports = ItemsRoute;