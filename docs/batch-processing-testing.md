# Plan de Pruebas - Batch Processing

## Pruebas Recomendadas

### 1. Pruebas Unitarias

#### Test: Batch INSERT exitoso
```javascript
describe('PostgresService.batchInsert', () => {
  it('debe insertar 100 registros en una sola consulta', async () => {
    const records = generateTestRecords(100);
    const results = await postgresService.saveRecords(
      records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_1', 'v1'
    );
    
    expect(results).toHaveLength(100);
    expect(results.every(r => r.status === 'success')).toBe(true);
  });
});
```

#### Test: Batch UPDATE exitoso
```javascript
it('debe actualizar múltiples registros con diferentes valores', async () => {
  const records = generateUpdateRecords(50);
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'update', schema, 'job_2', 'v1'
  );
  
  expect(results).toHaveLength(50);
  expect(results.every(r => r.status === 'success')).toBe(true);
});
```

#### Test: Batch DELETE exitoso
```javascript
it('debe eliminar múltiples registros en una operación', async () => {
  const records = generateDeleteRecords(30);
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'delete', schema, 'job_3', 'v1'
  );
  
  expect(results).toHaveLength(30);
  expect(results.every(r => r.status === 'success')).toBe(true);
});
```

#### Test: Fallback en caso de error
```javascript
it('debe usar fallback cuando el batch falla', async () => {
  const records = [
    ...generateValidRecords(50),
    generateInvalidRecord(), // Causa error en batch
    ...generateValidRecords(49)
  ];
  
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_4', 'v1'
  );
  
  expect(results).toHaveLength(100);
  expect(results.filter(r => r.status === 'success')).toHaveLength(99);
  expect(results.filter(r => r.status === 'error')).toHaveLength(1);
});
```

---

### 2. Pruebas de Integración

#### Test: Flujo completo con Redis + Worker + PostgreSQL
```javascript
describe('Flujo completo de batch processing', () => {
  it('debe procesar un job de Redis exitosamente', async () => {
    // 1. Agregar job a Redis
    await queue.add('process_batch', {
      operation: 'create',
      records: generateTestRecords(100),
      table_name: 'canota',
      client_id: 'TEST_CLIENT',
      field_id: 'id_cola',
      ver: 'v1'
    });
    
    // 2. Esperar procesamiento
    await waitForJobCompletion();
    
    // 3. Verificar resultados en PostgreSQL
    const count = await db.query('SELECT COUNT(*) FROM canota WHERE _client_id = $1', ['TEST_CLIENT']);
    expect(count.rows[0].count).toBe('100');
  });
});
```

---

### 3. Pruebas de Rendimiento

#### Test: Comparar throughput antes vs después
```javascript
describe('Rendimiento de batch processing', () => {
  it('debe procesar 1000 registros en menos de 5 segundos', async () => {
    const records = generateTestRecords(1000);
    const startTime = Date.now();
    
    await postgresService.saveRecords(
      records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_5', 'v1'
    );
    
    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000); // < 5 segundos
  });
  
  it('debe tener throughput > 200 rec/s', async () => {
    const records = generateTestRecords(1000);
    const startTime = Date.now();
    
    await postgresService.saveRecords(
      records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_6', 'v1'
    );
    
    const duration = (Date.now() - startTime) / 1000; // segundos
    const throughput = 1000 / duration;
    expect(throughput).toBeGreaterThan(200);
  });
});
```

#### Test: Carga sostenida
```javascript
it('debe mantener rendimiento con múltiples batches consecutivos', async () => {
  const throughputs = [];
  
  for (let i = 0; i < 10; i++) {
    const records = generateTestRecords(500);
    const startTime = Date.now();
    
    await postgresService.saveRecords(
      records, 'canota', `TEST_CLIENT_${i}`, 'id_cola', 'create', schema, `job_${i}`, 'v1'
    );
    
    const duration = (Date.now() - startTime) / 1000;
    throughputs.push(500 / duration);
  }
  
  const avgThroughput = throughputs.reduce((a, b) => a + b) / throughputs.length;
  expect(avgThroughput).toBeGreaterThan(200);
});
```

---

### 4. Pruebas de Casos Extremos

#### Test: Lote vacío
```javascript
it('debe manejar lote vacío sin errores', async () => {
  const results = await postgresService.saveRecords(
    [], 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_7', 'v1'
  );
  
  expect(results).toHaveLength(0);
});
```

#### Test: Registros con columnas heterogéneas
```javascript
it('debe manejar registros con diferentes columnas', async () => {
  const records = [
    { __meta: { id_cola: '001' }, campo_a: 'A', campo_b: 'B' },
    { __meta: { id_cola: '002' }, campo_a: 'A', campo_c: 'C' },
    { __meta: { id_cola: '003' }, campo_b: 'B', campo_d: 'D' }
  ];
  
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_8', 'v1'
  );
  
  expect(results).toHaveLength(3);
  expect(results.every(r => r.status === 'success')).toBe(true);
});
```

#### Test: Valores NULL y vacíos
```javascript
it('debe normalizar valores NULL correctamente', async () => {
  const records = [
    { __meta: { id_cola: '001' }, campo: null },
    { __meta: { id_cola: '002' }, campo: '' },
    { __meta: { id_cola: '003' }, campo: [null] },
    { __meta: { id_cola: '004' }, campo: undefined }
  ];
  
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_9', 'v1'
  );
  
  expect(results).toHaveLength(4);
  expect(results.every(r => r.status === 'success')).toBe(true);
});
```

#### Test: Caracteres especiales y encoding
```javascript
it('debe manejar caracteres especiales correctamente', async () => {
  const records = [
    { __meta: { id_cola: '001' }, nombre: 'José García' },
    { __meta: { id_cola: '002' }, nombre: 'Ñoño Pérez' },
    { __meta: { id_cola: '003' }, nombre: "O'Brien" }
  ];
  
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_10', 'v1'
  );
  
  expect(results).toHaveLength(3);
  expect(results.every(r => r.status === 'success')).toBe(true);
});
```

---

### 5. Pruebas de Errores

#### Test: Duplicate key violation
```javascript
it('debe manejar duplicate key con fallback', async () => {
  // Insertar registro inicial
  await postgresService.saveRecords(
    [{ __meta: { id_cola: '001' }, nombre: 'Test' }],
    'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_11', 'v1'
  );
  
  // Intentar insertar duplicado en batch
  const records = [
    { __meta: { id_cola: '001' }, nombre: 'Duplicate' }, // Error
    { __meta: { id_cola: '002' }, nombre: 'Valid' }
  ];
  
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_12', 'v1'
  );
  
  expect(results).toHaveLength(2);
  expect(results[0].status).toBe('error');
  expect(results[1].status).toBe('success');
  
  // Verificar que el error se guardó
  const errorCount = await db.query(
    'SELECT COUNT(*) FROM canota_errors WHERE record_id = $1',
    ['001']
  );
  expect(errorCount.rows[0].count).toBe('1');
});
```

#### Test: Foreign key violation
```javascript
it('debe manejar foreign key violation', async () => {
  const records = [
    { __meta: { id_cola: '001' }, cliente_id: 'INVALID_FK' }
  ];
  
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'create', schema, 'job_13', 'v1'
  );
  
  expect(results[0].status).toBe('error');
  expect(results[0].error).toContain('foreign key');
});
```

#### Test: UPDATE de registro inexistente
```javascript
it('debe reportar error cuando registro no existe para UPDATE', async () => {
  const records = [
    { __meta: { id_cola: 'NONEXISTENT' }, nombre: 'Updated' }
  ];
  
  const results = await postgresService.saveRecords(
    records, 'canota', 'TEST_CLIENT', 'id_cola', 'update', schema, 'job_14', 'v1'
  );
  
  expect(results[0].status).toBe('error');
  expect(results[0].error).toContain('no encontrado');
});
```

---

## Pruebas Manuales Recomendadas

### 1. Monitoreo en Tiempo Real
```bash
# Terminal 1: Monitorear logs del worker
tail -f logs/worker.log | grep "Batch"

# Terminal 2: Monitorear PostgreSQL
watch -n 1 'psql -c "SELECT COUNT(*) FROM canota WHERE _client_id = '\''TEST_CLIENT'\'';"'

# Terminal 3: Monitorear Redis
redis-cli INFO stats | grep instantaneous_ops_per_sec
```

### 2. Prueba de Carga con Artillery
```yaml
# artillery-load-test.yml
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Peak load"
scenarios:
  - name: "Batch insert"
    flow:
      - post:
          url: "/items"
          json:
            operation: "create"
            records: "{{ generateRecords(100) }}"
            table_name: "canota"
            client_id: "LOAD_TEST"
            field_id: "id_cola"
            ver: "v1"
```

```bash
# Ejecutar prueba de carga
artillery run artillery-load-test.yml
```

### 3. Comparación Antes/Después
```bash
# Crear script de benchmark
node scripts/benchmark-batch-processing.js

# Ejemplo de salida esperada:
# ========================================
# Benchmark: INSERT 1000 registros
# ========================================
# Método secuencial: 52.3 segundos (19.1 rec/s)
# Método batch:       2.1 segundos (476.2 rec/s)
# Mejora:             24.9x más rápido
# ========================================
```

---

## Métricas a Monitorear Post-Deploy

### 1. Throughput
- **Objetivo**: > 200 rec/s promedio
- **Crítico**: < 50 rec/s (indica problema)

### 2. Latencia de Batch
- **Objetivo**: < 1 segundo para 100 registros
- **Crítico**: > 5 segundos

### 3. Tasa de Fallback
- **Objetivo**: < 5% de batches requieren fallback
- **Crítico**: > 20% (indica problema sistemático)

### 4. Redis Queue Depth
- **Objetivo**: < 1000 jobs en cola
- **Crítico**: > 5000 jobs (saturación)

### 5. Errores en Tabla de Errores
- **Objetivo**: < 1% de registros con error
- **Crítico**: > 10% (revisar calidad de datos)

---

## Checklist Pre-Deploy

- [ ] Todas las pruebas unitarias pasan
- [ ] Pruebas de integración exitosas
- [ ] Benchmark muestra mejora > 10x
- [ ] Prueba de carga sostenida (30 min) sin degradación
- [ ] Fallback funciona correctamente
- [ ] Tabla de errores recibe registros fallidos
- [ ] Logs muestran información de batch/fallback
- [ ] Documentación actualizada
- [ ] Plan de rollback preparado

---

## Plan de Rollback

Si hay problemas después del deploy:

### Opción 1: Rollback de Código
```bash
git revert <commit-hash>
npm run deploy
```

### Opción 2: Feature Flag (Recomendado)
```javascript
// Agregar en postgresService.js
const USE_BATCH_PROCESSING = process.env.USE_BATCH_PROCESSING === 'true';

async saveRecords(...) {
  if (USE_BATCH_PROCESSING) {
    // Nuevo código batch
  } else {
    // Código legacy secuencial
  }
}
```

```bash
# Desactivar batch processing sin redeploy
export USE_BATCH_PROCESSING=false
pm2 restart all
```

---

## Contacto y Soporte

Si encuentras problemas durante las pruebas:
1. Revisar logs en `logs/worker.log`
2. Verificar tabla de errores: `SELECT * FROM {table}_errors`
3. Monitorear Redis: `redis-cli INFO`
4. Revisar PostgreSQL: `SELECT * FROM pg_stat_activity`
