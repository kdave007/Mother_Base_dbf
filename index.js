require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON
app.use(express.json());

// Debug route
app.get('/', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Import and register items routes
try {
  console.log('📥 Importando ItemsRoute...');
  const ItemsRoute = require('./src/routes/itemsRoute');
  const itemsRoute = new ItemsRoute(app);
  console.log('✅ ItemsRoute registrado correctamente');
} catch (error) {
  console.error('❌ Error registrando ItemsRoute:', error);
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});