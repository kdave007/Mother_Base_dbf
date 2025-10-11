const fs = require('fs').promises;
const path = require('path');

class SchemaService {
  constructor(schemasPath = './schemas') {
    this.schemasPath = schemasPath;
    this.schemasCache = new Map();
  }

  async loadTableSchema(tableName) {
    // Verificar cache primero
    if (this.schemasCache.has(tableName)) {
      return this.schemasCache.get(tableName);
    }

    try {
      const schemaPath = path.join(this.schemasPath, `${tableName.toLowerCase()}.json`);
      const schemaData = await fs.readFile(schemaPath, 'utf8');
      const schema = JSON.parse(schemaData);
      
      // Cachear el schema
      this.schemasCache.set(tableName, schema.fields);
      
      console.log(`Schema cargado: ${tableName}`);
      return schema.fields;
      
    } catch (error) {
      console.warn(`No se pudo cargar schema para ${tableName}:`, error.message);
      return null; // Fallback si no hay schema
    }
  }

  async getFieldMetadata(tableName, fieldName) {
    const schema = await this.loadTableSchema(tableName);
    if (!schema) return null;
    
    return schema.find(field => field.name === fieldName);
  }

  // Precargar schemas comunes
  async preloadSchemas(tableNames) {
    for (const tableName of tableNames) {
      await this.loadTableSchema(tableName);
    }
  }
}

module.exports = new SchemaService();