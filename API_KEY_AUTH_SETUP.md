# API Key Authentication with Redis Cache

## Overview
The authentication system now uses the existing `client_api_keys` table in PostgreSQL with Redis caching for improved performance.

## How It Works

1. **Database Query**: On startup, the system queries all active API keys from `client_api_keys` table
2. **Redis Cache**: API key hashes are stored in Redis with format `api_key:{hash}` → `client_id`
3. **Authentication**: When a client sends a request:
   - API key is hashed using SHA-256
   - System checks Redis cache first (fast)
   - If not in cache, queries database and updates cache
   - Returns client_id if valid

## Setup Steps

### 1. Install Dependencies
```bash
npm install
```

This will install `ioredis` which is now in package.json.

### 2. Ensure Redis is Running
Make sure Redis is running on the host/port specified in `.env`:
```
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Database Table Structure
The system expects the `client_api_keys` table with this structure:
- `client_id` (varchar) - Primary key, e.g., "XALAP_CBRIT"
- `api_key_hash` (varchar) - SHA-256 hash of the API key
- `is_active` (boolean) - Whether the key is active
- `updated_at` (timestamp) - Last update time

### 4. Start the Application
```bash
npm start
```

The startup process will:
- Connect to PostgreSQL
- Connect to Redis
- Load all active API keys into Redis cache
- Start the server

## API Key Service Features

### Cache Management
- **TTL**: 1 hour (3600 seconds)
- **Auto-refresh**: Keys are reloaded from DB if not found in cache
- **Prefix**: All cached keys use `api_key:` prefix

### Methods Available
- `validateApiKey(apiKey)` - Validates an API key and returns client_id
- `loadApiKeysToCache()` - Loads all active keys from DB to Redis
- `refreshCache()` - Clears and reloads all keys
- `addApiKey(clientId, apiKey)` - Adds/updates a key in DB and cache
- `revokeApiKey(clientId)` - Deactivates a key in DB and removes from cache

## Authentication Flow

```
Client Request → X-API-Key header
       ↓
Hash API key (SHA-256)
       ↓
Check Redis cache
       ↓
   Found? → Return client_id
       ↓
   Not found → Query PostgreSQL
       ↓
   Found? → Cache + Return client_id
       ↓
   Not found → 401 Unauthorized
```

## Performance Benefits

- **Cache Hit**: ~1-2ms response time
- **Cache Miss**: ~10-50ms (DB query + cache update)
- **Reduced DB Load**: Most requests served from Redis
- **Scalability**: Redis can handle thousands of requests/second

## Monitoring

Check the `/health` endpoint to verify Redis status:
```bash
curl http://localhost:3000/health
```

Response includes:
```json
{
  "services": {
    "postgresql": "connected",
    "redis": "connected",
    ...
  }
}
```

## Notes

- API keys are hashed using SHA-256 before storage and comparison
- The original plaintext API keys are never stored in the database
- Clients must send the original (unhashed) API key in the `X-API-Key` header
- The system automatically hashes it for comparison
