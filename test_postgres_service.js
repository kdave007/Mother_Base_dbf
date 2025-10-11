require('dotenv').config();
const postgresService = require('./src/services/postgresService');
const schemaService = require('./src/services/schemaService');

async function testPostgres() {
  console.log('🧪 Iniciando prueba con schema...\n');
  
  try {
    // 1. Cargar schema
    console.log('📖 Cargando schema de XCORTE...');
    const tableSchema = await schemaService.loadTableSchema('XCORTE');
    
    if (!tableSchema) {
      console.log('❌ No se pudo cargar el schema');
      return;
    }
    
    console.log('✅ Schema cargado:', tableSchema.length, 'campos');
    
    // 2. Datos de prueba
    const testRecords = [
      {
          "FOLIO": "",
          "FECHA": "25/09/2025",
          "FECHA_ELAB": "",
          "HORA_ELAB": "",
          "USUARIO": "",
          "VTACONT": "20931.0900",
          "SVTACONT": "398785.6600",
          "DESCONT": "3957.3300",
          "SDESCONT": "22150.9000",
          "VTACRED": "0.0000",
          "SVTACRED": "0.0000",
          "DESCRED": "0.0000",
          "SDESCRED": "0.0000",
          "COBRO": "0.0000",
          "SCOBRO": "0.0000",
          "GASTO": "0.0000",
          "SGASTO": "0.0000",
          "DEPOSITO": "16973.7600",
          "SDEPOSITO": "376634.7600",
          "EFECTIVO": "1744.0000",
          "SEFECTIVO": "99420.4800",
          "CHEQUE": "0.0000",
          "SCHEQUE": "30052.4200",
          "ENTPRO": "0.0000",
          "SENTPRO": "0.0000",
          "ENTSUC": "15056.5460",
          "SENTSUC": "509440.6122",
          "DEVCLI": "0.0000",
          "SDEVCLI": "5780.9800",
          "BAJDEV": "0.0000",
          "SBAJDEV": "0.0000",
          "SALSUC": "7786.0400",
          "SSALSUC": "136475.5177",
          "STOCK": "404089.6226",
          "SALSTOCK": "0.0000",
          "CONSASTOCK": "",
          "ENTSTOCK": "-170.0800",
          "CONETSTOCK": "Variacion con respecto a lista",
          "SCARTERA": "0.0200",
          "ENTCARTERA": "0.0000",
          "CONENCARTE": "",
          "SALCARTERA": "0.0000",
          "CONSACARTE": "",
          "DESCCARTER": "0.0000",
          "INICIOMES": "",
          "DDECONT": "0.0000",
          "SDDECONT": "0.0000",
          "DRECONT": "0.0000",
          "SDRECONT": "0.0000",
          "DDOCONT": "0.0000",
          "SDDOCONT": "5780.9800",
          "DDECRED": "0.0000",
          "SDDECRED": "0.0000",
          "DRECRED": "0.0000",
          "SDRECRED": "0.0000",
          "DDOCRED": "0.0000",
          "SDDOCRED": "0.0000",
          "DECRED": "0.0000",
          "SDECRED": "0.0000",
          "DECONT": "3957.3300",
          "SDECONT": "16369.9200",
          "SALEEYS": "0.0000",
          "SSALEEYS": "6207.9177",
          "SALEVALE": "7786.0400",
          "SSALEVALE": "130267.6000",
          "ENTEYS": "15056.5460",
          "SENTEYS": "509440.6122",
          "ENTVALE": "0.0000",
          "SENTVALE": "0.0000",
          "DEPTC": "15229.9100",
          "SDEPTC": "247167.7000",
          "CORTEZ": "0.0000",
          "SCORTEZ": "0.0000",
          "IMP_Z": "0.0000",
          "SIMP_Z": "0.0000",
          "ERRORZ": "0.0000",
          "SERRORZ": "0",
          "AJUSTEZ": "0",
          "SAJUSTEZ": "0",
          "PCAJA": "-0.1500",
          "SPCAJA": "-5.8400",
          "CAMPO1": "0",
          "CAMPO2": "0.0000",
          "CAMPO3": "0.0000",
          "CAMPO4": "0.0000",
          "CAMPO5": "0.0000",
          "CAMPO6": "0.0000",
          "CAMPO7": "0.0000",
          "CAMPO8": "0.0000",
          "CAMPO9": "0.0000",
          "CAMPO10": "0.0000",
          "CAMPO11": "",
          "CAMPO12": "",
          "CAMPO13": "",
          "CAMPO14": "",
          "CAMPO15": "0",
          "CORT_TIEND": "",
          "CAJA_CLAVE": "01",
          "TURN_CLAVE": "",
          "CORT_1TICK": "",
          "CORT_UTICK": "",
          "IMPTOCOM": "0",
          "IMPTOFAC": "0",
          "IMPTODEV": "0",
          "IMPTO1": "0.0000",
          "IMPTO2": "0.0000",
          "TIENDA": "ARAUC",
          "MODHORA": "20:03:00",
          "MODFECHA": "25/09/2025",
          "MODUSER": "GTE",
          "__meta": {
              "hash_id": "0568aeaa47f8f1618ff7f27ef4afa1d4",
              "recno": 5590,
              "hash_comparador": "710f82476f2d2dc441f23f7a5b9063b0"
          }
      }
    ];
    
    console.log('\n📤 Enviando registro de prueba:');
    console.log('   - FECHA (string):', testRecords[0].FECHA);
    console.log('   - VTACONT (string):', testRecords[0].VTACONT);
    console.log('   - CENTRAL (string):', testRecords[0].CENTRAL);
    
    // 3. Procesar registros
    const results = await postgresService.saveRecords(
      testRecords,
      'xcorte',           // table_name
      'TEST_CLIENT',      // client_id
      'hash_id',          // field_id  
      'create',           // operation
      tableSchema         // schema
    );
    
    console.log('\n✅ Resultados de la inserción:');
    console.log(JSON.stringify(results, null, 2));
    
    // 4. Verificar conversión
    console.log('\n🔍 Verificación de conversión:');
    if (results[0].status === 'success') {
      console.log('   ✅ Inserción exitosa');
      console.log('   📝 ID del registro:', results[0].postgres_id);
    } else {
      console.log('   ❌ Error:', results[0].error);
    }
    
  } catch (error) {
    console.error('\n💥 Error en la prueba:', error.message);
    console.log('\n🔧 Solución:');
    console.log('   - Verifica que PostgreSQL esté corriendo');
    console.log('   - Verifica la tabla xcorte exista en la BD');
    console.log('   - Verifica las credenciales en .env');
  }
}

// Ejecutar prueba
testPostgres();