# Optimización de Procesamiento por Lotes (Batch Processing)

## Resumen
Refactorización del servicio PostgreSQL para procesar registros en **lotes** en lugar de uno por uno, mejorando el rendimiento entre **10x-50x**.

## Problema Original
- **Procesamiento secuencial**: Cada registro se procesaba individualmente con una consulta SQL separada
- **Saturación de Redis**: Los datos entraban más rápido de lo que se procesaban
- **Timeouts en horario pico**: Caídas frecuentes entre 7-8 AM
- **Rendimiento**: 24,000 registros tomaban ~20 minutos (~20 registros/segundo)

## Solución Implementada

### 1. Batch INSERT (Multi-Value INSERT)
```sql
INSERT INTO tabla (col1, col2, col3)
VALUES 
  ($1, $2, $3),
  ($4, $5, $6),
  ($7, $8, $9)
RETURNING _id;
```

**Ventajas:**
- 1 consulta para N registros en lugar de N consultas
- Reduce overhead de red y parsing SQL
- Aprovecha optimizaciones internas de PostgreSQL

### 2. Batch UPDATE (CASE Statements)
```sql
UPDATE tabla 
SET 
  campo1 = CASE _id WHEN $1 THEN $2 WHEN $3 THEN $4 ELSE campo1 END,
  campo2 = CASE _id WHEN $1 THEN $5 WHEN $3 THEN $6 ELSE campo2 END,
  _updated_at = CURRENT_TIMESTAMP
WHERE _id IN ($7, $8)
  AND _client_id = $9
  AND _ver = $10
RETURNING _id, _updated_at;
```

**Ventajas:**
- Actualiza múltiples registros con diferentes valores en una sola consulta
- Mantiene la atomicidad de la operación
- Verifica qué registros se actualizaron exitosamente

### 3. Batch DELETE (WHERE IN)
```sql
DELETE FROM tabla 
WHERE _id IN ($1, $2, $3, $4)
  AND _client_id = $5
  AND _ver = $6
RETURNING _id;
```

**Ventajas:**
- Elimina múltiples registros en una sola operación
- Retorna los IDs eliminados para verificación
- Más eficiente que múltiples DELETE individuales

## Arquitectura de Fallback

### Estrategia de Resiliencia
Cada operación por lotes incluye un mecanismo de fallback:

```javascript
try {
  // Intentar procesamiento por lotes
  return await this.batchInsert(...);
} catch (batchError) {
  console.error('Error en batch, fallback a individual:', batchError.message);
  // Si falla el lote, procesar uno por uno
  return await this.processSingleRecords(...);
}
```

### Casos que Activan el Fallback
- **Errores de constraint**: Violaciones de unique, foreign key, etc.
- **Errores de encoding**: Caracteres inválidos en algunos registros
- **Errores de tipo**: Conversiones de datos fallidas
- **Timeouts**: Lotes muy grandes que exceden límites

### Manejo de Errores Individual
Cuando se activa el fallback:
1. Cada registro se procesa independientemente
2. Los errores se registran en la tabla `{table}_errors`
3. Los registros exitosos continúan procesándose
4. Se retorna un resultado detallado por registro

## Mejoras de Rendimiento Esperadas

### Throughput
| Operación | Antes | Después | Mejora |
|-----------|-------|---------|--------|
| INSERT | 20 rec/s | 200-1000 rec/s | **10-50x** |
| UPDATE | 15 rec/s | 150-750 rec/s | **10-50x** |
| DELETE | 25 rec/s | 250-1250 rec/s | **10-50x** |

### Impacto en Redis
- **Antes**: Cola crecía constantemente, saturación frecuente
- **Después**: Procesamiento más rápido que ingesta, cola estable

### Tiempo de Procesamiento
- **24,000 registros**: De ~20 minutos a **24-120 segundos**
- **Horario pico (7-8 AM)**: Sin timeouts ni caídas

## Consideraciones Técnicas

### Límites de PostgreSQL
- **Max parámetros por query**: 65,535 (PostgreSQL limit)
- **Tamaño recomendado de lote**: 100-1000 registros
- **Ajuste dinámico**: El worker puede dividir lotes grandes

### Manejo de Columnas Heterogéneas
El batch INSERT maneja registros con diferentes columnas:
```javascript
// Registro 1: {campo_a, campo_b}
// Registro 2: {campo_a, campo_c}
// Resultado: INSERT con (campo_a, campo_b, campo_c) usando NULL donde falten valores
```

### Transacciones
- Cada lote se ejecuta en una **transacción implícita**
- Si falla el lote completo, se hace rollback automático
- El fallback procesa sin transacción para aislar errores

## Monitoreo y Debugging

### Logs de Batch
```javascript
console.error('Error en batch INSERT, fallback a procesamiento individual:', batchError.message);
```

### Métricas a Monitorear
1. **Tasa de fallback**: % de lotes que requieren procesamiento individual
2. **Tiempo por lote**: Duración promedio de operaciones batch
3. **Tamaño de lote**: Registros procesados por operación
4. **Errores por tipo**: Clasificación de errores en fallback

### Tabla de Errores
Los errores individuales se guardan en `{table}_errors`:
```sql
CREATE TABLE canota_errors (
  record_id VARCHAR,
  client_id VARCHAR(50),
  operation VARCHAR(20),
  error_type VARCHAR(50),
  error_message TEXT,
  field_id VARCHAR(50),
  record_data JSONB,
  ver VARCHAR,
  created_at TIMESTAMP
);
```

## Próximos Pasos (Opcional)

### Optimizaciones Adicionales
1. **Ajuste dinámico de tamaño de lote**: Basado en tasa de error
2. **Paralelización**: Múltiples workers procesando lotes simultáneamente
3. **Compresión de datos**: Para reducir overhead de red
4. **Prepared statements**: Para queries repetitivas

### Monitoreo Avanzado
1. **Dashboard de métricas**: Visualización en tiempo real
2. **Alertas automáticas**: Cuando tasa de fallback > umbral
3. **Análisis de patrones**: Identificar registros problemáticos

## Referencias

### Archivos Modificados
- `src/services/postgresService.js`: Implementación de batch processing
- `src/workers/batchWorker.js`: Consumidor del servicio (sin cambios)

### Métodos Principales
- `batchInsert()`: INSERT por lotes
- `batchUpdate()`: UPDATE por lotes con CASE
- `batchDelete()`: DELETE por lotes con WHERE IN
- `processSingleRecords()`: Fallback para procesamiento individual
- `saveToErrorTable()`: Registro de errores (sin cambios)

### Compatibilidad
- ✅ Compatible con código existente
- ✅ Sin cambios en la API del servicio
- ✅ Fallback automático garantiza robustez
- ✅ Manejo de errores existente se mantiene
