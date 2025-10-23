const axios = require('axios');

const API_URL = 'http://localhost:3000/items';
const API_KEY = 'LWDSDxN2tH';

const CLIENTS = [
  'ARAUC_XALAP',
  'ROTON_XALAP',
  'CIRCU_XALAP',
  'XJALC_XALAP',
  'BRUNO_XALAP',
  'REVOL_XALAP',
  'XMART_XALAP',
  'ATENA_XALAP',
  'REBSA_XALAP',
  'CARRI_XALAP'
];

async function sendRequest(clientId, requestNum) {
  try {
    const response = await axios.post(API_URL, {
      client_id: clientId,
      operation: 'create',
      table_name: 'test_table',
      records: []
    }, {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✓ ${clientId} - Request #${requestNum}: ${response.status}`);
    return true;
  } catch (error) {
    console.error(`✗ ${clientId} - Request #${requestNum}: ${error.message}`);
    return false;
  }
}

async function testConcurrentClients() {
  console.log('🧪 Testing Activity Tracker with Concurrent Clients\n');
  console.log(`Simulating ${CLIENTS.length} clients sending requests...\n`);

  // Test 1: All clients send 1 request simultaneously
  console.log('📤 Test 1: Simultaneous requests from all clients');
  const promises1 = CLIENTS.map(clientId => sendRequest(clientId, 1));
  await Promise.all(promises1);
  
  console.log('\n⏳ Waiting 2 seconds for flush...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 2: Each client sends 5 requests rapidly
  console.log('📤 Test 2: Rapid requests (5 per client)');
  const promises2 = [];
  for (let i = 1; i <= 5; i++) {
    for (const clientId of CLIENTS) {
      promises2.push(sendRequest(clientId, i));
    }
  }
  await Promise.all(promises2);

  console.log('\n⏳ Waiting 3 seconds for flush...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Test 3: Staggered requests
  console.log('📤 Test 3: Staggered requests');
  for (const clientId of CLIENTS) {
    sendRequest(clientId, 'staggered'); // Fire and forget
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
  }

  console.log('\n⏳ Waiting 2 seconds for final flush...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n✅ All tests complete!');
  console.log('\n📊 Check your database:');
  console.log('   SELECT * FROM client_activity ORDER BY last_seen DESC;');
  console.log(`\n   Expected: ${CLIENTS.length} rows (one per client)`);
}

testConcurrentClients().catch(console.error);
