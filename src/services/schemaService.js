

const fs = require('fs').promises;
const path = require('path');

class SchemaService {
  constructor() {
    // Para desarrollo local y Docker
    this.schemasPath = path.join(__dirname, '../../schemas');
    this.schemasCache = new Map();
    console.log('📂 SchemaService configurado en:', this.schemasPath);
  }

  async loadTableSchema(tableName) {
    if (this.schemasCache.has(tableName)) {
      return this.schemasCache.get(tableName);
    }

    try {
      // Buscar el archivo EXACTO (sin cambiar case)
      const schemaPath = path.join(this.schemasPath, `${tableName}.json`);
      console.log(`🔍 Buscando schema: ${schemaPath}`);
      
      const schemaData = await fs.readFile(schemaPath, 'utf8');
      const schema = JSON.parse(schemaData);
      
      this.schemasCache.set(tableName, schema.fields);
      console.log(`✅ Schema cargado: ${tableName}`);
      
      return schema.fields;
      
    } catch (error) {
      console.warn(`❌ Error cargando schema ${tableName}:`, error.message);
      return null;
    }
  }
}

module.exports = new SchemaService();