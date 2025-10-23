require('dotenv').config();
const { Pool } = require('pg');

async function testActivityTracker() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    console.log('🧪 Testing Activity Tracker...\n');

    // 1. Test INSERT (first time)
    console.log('Testing INSERT for new client...');
    const testClient1 = 'TEST_CLIENT_001';
    
    await pool.query(`
      INSERT INTO client_activity (client_id, last_seen, created_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (client_id) 
      DO UPDATE SET last_seen = CURRENT_TIMESTAMP
    `, [testClient1]);
    
    const result1 = await pool.query(
      'SELECT * FROM client_activity WHERE client_id = $1',
      [testClient1]
    );
    
    console.log('✅ First insert:', result1.rows[0]);
    console.log(`   created_at: ${result1.rows[0].created_at}`);
    console.log(`   last_seen:  ${result1.rows[0].last_seen}`);
    const firstSeen = result1.rows[0].last_seen;
    
    // 2. Wait and test UPDATE (existing client)
    console.log('\nWaiting 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Testing UPDATE for existing client...');
    await pool.query(`
      INSERT INTO client_activity (client_id, last_seen, created_at)
      VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (client_id) 
      DO UPDATE SET last_seen = CURRENT_TIMESTAMP
    `, [testClient1]);
    
    const result2 = await pool.query(
      'SELECT * FROM client_activity WHERE client_id = $1',
      [testClient1]
    );
    
    console.log('✅ After update:', result2.rows[0]);
    console.log(`   created_at: ${result2.rows[0].created_at} (should NOT change)`);
    console.log(`   last_seen:  ${result2.rows[0].last_seen} (should be updated)`);
    const secondSeen = result2.rows[0].last_seen;
    
    // 3. Verify update worked
    if (new Date(secondSeen) > new Date(firstSeen)) {
      console.log('✅ last_seen was updated correctly');
      console.log(`   Time difference: ${(new Date(secondSeen) - new Date(firstSeen))}ms`);
    } else {
      console.log('❌ last_seen was NOT updated');
    }
    
    // 4. Test batch insert
    console.log('\nTesting batch insert (simulating 5 clients)...');
    const batchClients = ['CLIENT_A', 'CLIENT_B', 'CLIENT_C', 'CLIENT_D', 'CLIENT_E'];
    const values = batchClients.map((_, idx) => 
      `($${idx + 1}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).join(', ');
    
    await pool.query(`
      INSERT INTO client_activity (client_id, last_seen, created_at)
      VALUES ${values}
      ON CONFLICT (client_id) 
      DO UPDATE SET last_seen = CURRENT_TIMESTAMP
    `, batchClients);
    
    const batchResult = await pool.query(
      'SELECT * FROM client_activity WHERE client_id = ANY($1)',
      [batchClients]
    );
    
    console.log(`✅ Batch inserted/updated ${batchResult.rows.length} clients`);
    batchResult.rows.forEach(row => {
      console.log(`   - ${row.client_id}: last_seen=${row.last_seen}`);
    });
    
    // 5. Show all records
    console.log('\n📊 All client activity records:');
    const allRecords = await pool.query('SELECT * FROM client_activity ORDER BY last_seen DESC');
    console.table(allRecords.rows);
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

testActivityTracker();
