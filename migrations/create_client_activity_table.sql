-- Migration: Create client_activity table
-- Purpose: Track client activity timestamps for monitoring and analytics
-- Date: 2025-10-23

-- Create the client_activity table
CREATE TABLE IF NOT EXISTS client_activity (
    client_id VARCHAR(50) PRIMARY KEY,
    last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Add index for querying by last_seen (for finding inactive clients)
CREATE INDEX IF NOT EXISTS idx_client_activity_last_seen 
ON client_activity(last_seen DESC);

-- Add comments for documentation
COMMENT ON TABLE client_activity IS 'Tracks when clients last sent requests to the API';
COMMENT ON COLUMN client_activity.client_id IS 'Unique identifier for the client';
COMMENT ON COLUMN client_activity.last_seen IS 'Timestamp of most recent activity (updated on every request)';
COMMENT ON COLUMN client_activity.created_at IS 'Timestamp when client was first seen (never updated)';

-- Example queries:

-- Get all active clients
-- SELECT * FROM client_activity ORDER BY last_seen DESC;

-- Get clients active in last hour
-- SELECT * FROM client_activity WHERE last_seen > NOW() - INTERVAL '1 hour';

-- Get inactive clients (not seen in 24 hours)
-- SELECT * FROM client_activity WHERE last_seen < NOW() - INTERVAL '24 hours';

-- Count total clients
-- SELECT COUNT(*) FROM client_activity;

-- Get client activity summary
-- SELECT 
--   COUNT(*) as total_clients,
--   COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '1 hour') as active_last_hour,
--   COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '24 hours') as active_last_day,
--   COUNT(*) FILTER (WHERE last_seen < NOW() - INTERVAL '24 hours') as inactive
-- FROM client_activity;
