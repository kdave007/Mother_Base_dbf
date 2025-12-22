const pgPool = require('../db/database');

class ActivityTracker {
  constructor() {
    // Use existing database pool
    this.pool = pgPool;

    // In-memory buffer for batching updates
    this.activityBuffer = new Map();
    this.retryCount = new Map(); // Track retry attempts per client_id
    this.maxDataRetries = 3; // Max retries for data validation errors
    this.flushInterval = 30000; // Flush every 30 seconds
    this.maxBufferSize = 100; // Flush when buffer reaches 100 entries
    this.isConnected = false;
    this.connectionRetries = 0;
    this.maxRetries = 5;
    this.isFlushing = false; // Prevent concurrent flushes

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
      // Check both query params (NDJSON) and body (JSON)
      let clientId = req.query?.client_id || req.body?.client_id;
      
      if (clientId) {
        // Truncate client_id to fit varchar(50) constraint
        clientId = String(clientId).substring(0, 50);
        
        // Add to buffer (non-blocking, instant)
        this.activityBuffer.set(clientId, Date.now());
        console.log(`📝 Added ${clientId} to buffer (size: ${this.activityBuffer.size})`);
        
        // Flush if buffer is full
        if (this.activityBuffer.size >= this.maxBufferSize) {
          console.log(`🚀 Buffer full (${this.activityBuffer.size}), triggering flush...`);
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
        console.log(`⏰ Periodic flush triggered (buffer size: ${this.activityBuffer.size})`);
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
      console.warn('⚠ Activity Tracker: Dropping buffer - not connected to database');
      // Drop all buffered entries and retry counts to avoid infinite retry loops
      this.activityBuffer.clear();
      this.retryCount.clear();
      return;
    }

    // Prevent concurrent flushes
    if (this.isFlushing) {
      console.log('⏳ Flush already in progress, skipping...');
      return;
    }

    this.isFlushing = true;

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
      
      // Truncate all client_ids to fit varchar(50) constraint
      const clientIds = entries.map(([clientId]) => String(clientId).substring(0, 50));

      const query = `
        INSERT INTO client_activity (client_id, last_seen, created_at)
        VALUES ${values}
        ON CONFLICT (client_id) 
        DO UPDATE SET last_seen = CURRENT_TIMESTAMP
      `;

      await client.query(query, clientIds);
      console.log(`✓ Flushed ${entries.length} client activities`);
      
      // Clear retry counts for successful entries
      entries.forEach(([clientId]) => {
        this.retryCount.delete(clientId);
      });
    } catch (error) {
      console.error('Batch insert error:', error.message);
      console.error('Full error:', error);
      
      // Mark as disconnected and try to reconnect
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        this.isConnected = false;
        console.log('⚠ Connection lost, attempting to reconnect...');
        this.testConnection();
      }
      
      // Re-add failed entries to buffer for retry, but only if not a data validation error
      const isDataValidationError = error.code === '22001' || // string too long
                                     error.code === '22003' || // numeric out of range
                                     error.code === '22P02';   // invalid text representation
      
      if (isDataValidationError) {
        console.error('⚠ Data validation error detected. Entries will NOT be retried to prevent infinite loop.');
        // Clear retry counts for these entries
        entries.forEach(([clientId]) => {
          this.retryCount.delete(clientId);
        });
      } else {
        // Only retry for connection/transient errors
        entries.forEach(([clientId, timestamp]) => {
          const retries = (this.retryCount.get(clientId) || 0) + 1;
          
          if (retries <= this.maxDataRetries) {
            this.activityBuffer.set(clientId, timestamp);
            this.retryCount.set(clientId, retries);
            console.log(`🔄 Retry ${retries}/${this.maxDataRetries} for client_id: ${clientId}`);
          } else {
            console.error(`❌ Max retries (${this.maxDataRetries}) reached for client_id: ${clientId}. Dropping entry.`);
            this.retryCount.delete(clientId);
          }
        });
      }
    } finally {
      if (client) {
        client.release();
      }
      this.isFlushing = false; // Release lock
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
