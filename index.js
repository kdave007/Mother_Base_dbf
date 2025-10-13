require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ✅ Worker avanzado se auto-inicia
require('./src/workers/batchWorker');

// Routes
const ItemsRoute = require('./src/routes/itemsRoute');
new ItemsRoute(app);

// Ruta de salud
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📤 Endpoint: POST http://localhost:${PORT}/items`);
  console.log(`❤️  Health: GET http://localhost:${PORT}/health`);
});