const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Load environment variables
require('dotenv').config();

// Middleware para parsear JSON
app.use(express.json());

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ mensaje: '¡API REST funcionando!' });
});

// Import and register items routes
const ItemsRoute = require('./routes/itemsRoute');
const itemsRoute = new ItemsRoute();
itemsRoute.registerRoutes(app);

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});