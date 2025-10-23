const { Pool } = require('pg');

class ActivityTracker {
  constructor() {
    // Dedicated connection pool for activity tracking
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 20, // Dedicated connections for activity tracking
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // In-memory buffer for batching updates
    this.activityBuffer = new Map();
    this.flushInterval = 1000; // Flush every 1 second
    this.maxBufferSize = 100; // Flush when buffer reaches 100 entries

    // Start periodic flush
    this.startPeriodicFlush();
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

    // Get current buffer and clear it immediately
    const entries = Array.from(this.activityBuffer.entries());
    this.activityBuffer.clear();

    const client = await this.pool.connect();
    try {
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
      console.error('Batch insert error:', error);
      // Re-add failed entries to buffer for retry
      entries.forEach(([clientId, timestamp]) => {
        this.activityBuffer.set(clientId, timestamp);
      });
    } finally {
      client.release();
    }
  }

  async shutdown() {
    // Clear interval
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Flush remaining entries before shutdown
    await this.flushBuffer();
    
    // Close pool
    await this.pool.end();
    console.log('Activity tracker shut down gracefully');
  }
}

module.exports = ActivityTracker;
