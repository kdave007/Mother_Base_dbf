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
            // Preserve the full decimal value as sent by the client; do not round/truncate
            return isNaN(num) ? null : num;
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
            // Preserve the full decimal value as sent by the client; do not round/truncate
            return isNaN(num) ? null : num;
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
  
    /**
   * Normaliza un valor para garantizar que nunca se devuelvan arreglos como [null].
   * Convierte undefined, '' (cadena vacía), o [null] a null.
   * @param {*} value - El valor a normalizar
   * @returns {*} - El valor normalizado
   */
  normalizeValue(value) {
    // Si es undefined o cadena vacía, retornar null
    if (value === undefined || value === '') {
      return null;
    }

    // Si es un arreglo con un solo elemento null, retornar null
    if (Array.isArray(value) && value.length === 1 && value[0] === null) {
      return null;
    }

    // Retornar el valor tal cual
    return value;
  }

  convertValue(value, fieldMetadata) {
    if (value === null || value === undefined || value === '') {
      return fieldMetadata.nullable ? null : '';
    }

    const typeConfig = this.typeMappings[fieldMetadata.type];
    if (!typeConfig || !typeConfig.convert) {
      return this.normalizeValue(String(value)); // Fallback a string normalizado
    }

    try {
      const convertedValue = typeConfig.convert(value, fieldMetadata.decimal_places);
      return this.normalizeValue(convertedValue);
    } catch (error) {
      console.warn(`Error convirtiendo campo ${fieldMetadata.name}:`, error);
      return this.normalizeValue(String(value)); // Fallback seguro normalizado
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