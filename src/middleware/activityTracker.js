const pgPool = require('../db/database');

class ActivityTracker {
  constructor() {
    // Use existing database pool
    this.pool = pgPool;

    // In-memory buffer for batching updates
    this.activityBuffer = new Map();
    this.flushInterval = 1000; // Flush every 1 second
    this.maxBufferSize = 100; // Flush when buffer reaches 100 entries
    this.isConnected = false;
    this.connectionRetries = 0;
    this.maxRetries = 5;

    // Test connection before starting
    this.testConnection();

    // Start periodic flush
    this.startPeriodicFlush();
  }

  async testConnection() {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      this.isConnected = true;
      this.connectionRetries = 0;
      console.log('✓ Activity Tracker connected to database');
    } catch (error) {
      this.isConnected = false;
      this.connectionRetries++;
      console.error(`✗ Activity Tracker connection failed (attempt ${this.connectionRetries}/${this.maxRetries}):`, error.message);
      
      if (this.connectionRetries < this.maxRetries) {
        // Retry after 5 seconds
        setTimeout(() => this.testConnection(), 5000);
      } else {
        console.error('✗ Activity Tracker: Max connection retries reached. Will continue without activity tracking.');
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      const clientId = req.body?.client_id;
      
      if (clientId) {
        // Add to buffer (non-blocking, instant)
        this.activityBuffer.set(clientId, Date.now());
        
        // Flush if buffer is full
        if (this.activityBuffer.size >= this.maxBufferSize) {
          this.flushBuffer().catch(err => 
            console.error('Activity flush error:', err)
          );
        }
      }
      
      next(); // Continue immediately without waiting
    };
  }

  startPeriodicFlush() {
    this.flushTimer = setInterval(() => {
      if (this.activityBuffer.size > 0) {
        this.flushBuffer().catch(err => 
          console.error('Periodic flush error:', err)
        );
      }
    }, this.flushInterval);
  }

  async flushBuffer() {
    if (this.activityBuffer.size === 0) return;

    // Skip if not connected
    if (!this.isConnected) {
      console.warn('⚠ Activity Tracker: Skipping flush - not connected to database');
      return;
    }

    // Get current buffer and clear it immediately
    const entries = Array.from(this.activityBuffer.entries());
    this.activityBuffer.clear();

    let client;
    try {
      client = await this.pool.connect();
      
      // Build batch upsert query
      // ON CONFLICT handles: if client_id exists, UPDATE last_seen; otherwise INSERT new row
      const values = entries.map(([clientId], idx) => 
        `($${idx + 1}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).join(', ');
      
      const clientIds = entries.map(([clientId]) => clientId);

      const query = `
        INSERT INTO client_activity (client_id, last_seen, created_at)
        VALUES ${values}
        ON CONFLICT (client_id) 
        DO UPDATE SET last_seen = CURRENT_TIMESTAMP
      `;

      await client.query(query, clientIds);
      console.log(`✓ Flushed ${entries.length} client activities`);
    } catch (error) {
      console.error('Batch insert error:', error.message);
      
      // Mark as disconnected and try to reconnect
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.isConnected = false;
        console.log('⚠ Connection lost, attempting to reconnect...');
        this.testConnection();
      }
      
      // Re-add failed entries to buffer for retry
      entries.forEach(([clientId, timestamp]) => {
        this.activityBuffer.set(clientId, timestamp);
      });
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async shutdown() {
    // Clear interval
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Flush remaining entries before shutdown
    await this.flushBuffer();
    
    // Don't close the shared pool - it's managed by the main app
    console.log('Activity tracker shut down gracefully');
  }
}

module.exports = ActivityTracker;
