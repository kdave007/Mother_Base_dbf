class TypeMapper {
    constructor(typeMappings) {
      this.typeMappings = typeMappings || {
        "C": {
          "postgresql_type": "VARCHAR({length})",
          "uses_length": true,
          "uses_decimal_places": false,
          "handles_nullable": true,
          "convert": (value) => value ? String(value).trim() : null
        },
        "N": {
          "postgresql_type": "NUMERIC({length},{decimal_places})",
          "uses_length": true,
          "uses_decimal_places": true,
          "handles_nullable": true,
          "convert": (value, decimal_places = 0) => {
            if (!value || value === '') return null;
            const num = parseFloat(value);
            return isNaN(num) ? null : Number(num.toFixed(decimal_places));
          }
        },
        "F": {
          "postgresql_type": "NUMERIC({length},{decimal_places})",
          "uses_length": true,
          "uses_decimal_places": true,
          "handles_nullable": true,
          "convert": (value, decimal_places = 0) => {
            if (!value || value === '') return null;
            const num = parseFloat(value);
            return isNaN(num) ? null : Number(num.toFixed(decimal_places));
          }
        },
        "D": {
          "postgresql_type": "DATE",
          "uses_length": false,
          "uses_decimal_places": false,
          "handles_nullable": true,
          "convert": (value) => {
            if (!value || value === '') return null;
            // Convierte "25/09/2025" → "2025-09-25"
            const parts = value.split('/');
            if (parts.length === 3) {
              return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            return value;
          }
        },
        "L": {
          "postgresql_type": "BOOLEAN",
          "uses_length": false,
          "uses_decimal_places": false,
          "handles_nullable": true,
          "convert": (value) => {
            if (!value || value === '') return null;
            const val = String(value).toUpperCase();
            return val === 'T' || val === 'Y' || val === 'S' || val === '1';
          }
        },
        "M": {
          "postgresql_type": "TEXT",
          "uses_length": false,
          "uses_decimal_places": false,
          "handles_nullable": true,
          "convert": (value) => value ? String(value) : null
        }
      };
    }
  
    convertValue(value, fieldMetadata) {
      if (value === null || value === undefined || value === '') {
        return fieldMetadata.nullable ? null : '';
      }
  
      const typeConfig = this.typeMappings[fieldMetadata.type];
      if (!typeConfig || !typeConfig.convert) {
        return String(value); // Fallback a string
      }
  
      try {
        return typeConfig.convert(value, fieldMetadata.decimal_places);
      } catch (error) {
        console.warn(`Error convirtiendo campo ${fieldMetadata.name}:`, error);
        return String(value); // Fallback seguro
      }
    }
  
    getPostgreSQLType(fieldMetadata) {
      const typeConfig = this.typeMappings[fieldMetadata.type];
      if (!typeConfig) return 'TEXT';
  
      let type = typeConfig.postgresql_type;
      
      if (typeConfig.uses_length) {
        type = type.replace('{length}', fieldMetadata.length || 255);
      }
      
      if (typeConfig.uses_decimal_places) {
        type = type.replace('{decimal_places}', fieldMetadata.decimal_places || 0);
      }
      
      return type;
    }
  }
  
  module.exports = TypeMapper;