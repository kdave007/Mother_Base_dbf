// const fs = require('fs').promises;
// const path = require('path');

// class QueueLogger {
//   constructor(logsDir = './logs') {
//     this.logsDir = logsDir;
//     this.setupLogsDirectory();
//   }

//   async setupLogsDirectory() {
//     try {
//       await fs.mkdir(this.logsDir, { recursive: true });
//     } catch (error) {
//       console.error('Error creando directorio de logs:', error);
//     }
//   }

//   getLogFileName() {
//     const date = new Date().toISOString().split('T')[0];
//     return `queue_${date}.log`;
//   }

//   async log(level, message, data = null) {
//     const timestamp = new Date().toISOString();
//     const logEntry = {
//       timestamp,
//       level,
//       message,
//       data
//     };

//     const logLine = `${timestamp} [${level}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
    
//     try {
//       const logFile = path.join(this.logsDir, this.getLogFileName());
//       await fs.appendFile(logFile, logLine, 'utf8');
//     } catch (error) {
//       console.error('Error escribiendo log:', error);
//     }

//     console.log(`[${level}] ${message}`, data || '');
//   }

//   async info(message, data = null) {
//     await this.log('INFO', message, data);
//   }

//   async error(message, data = null) {
//     await this.log('ERROR', message, data);
//   }

//   async warn(message, data = null) {
//     await this.log('WARN', message, data);
//   }

//   async debug(message, data = null) {
//     await this.log('DEBUG', message, data);
//   }
// }

// // ✅ ESTA LÍNEA ES IMPORTANTE - Exportar la INSTANCIA
// module.exports = new QueueLogger();

const fs = require('fs').promises;
const path = require('path');

class QueueLogger {
  constructor() {
    // Usar la misma lógica que SchemaService - path universal
    this.logsDir = path.join(__dirname, '../../logs');
    this.setupLogsDirectory();
    console.log('📝 Logger configurado en:', this.logsDir);
  }

  async setupLogsDirectory() {
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
      console.log('✅ Directorio de logs listo:', this.logsDir);
      
      // Verificar permisos de escritura
      const testFile = path.join(this.logsDir, 'test_write.log');
      await fs.writeFile(testFile, 'Test de escritura\n');
      await fs.unlink(testFile);
      console.log('✅ Permisos de escritura verificados');
      
    } catch (error) {
      console.error('❌ Error configurando directorio de logs:', error.message);
    }
  }

  getLogFileName() {
    const date = new Date().toISOString().split('T')[0];
    return `queue_${date}.log`;
  }

  async log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    const logLine = `${timestamp} [${level}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
    
    try {
      const logFile = path.join(this.logsDir, this.getLogFileName());
      await fs.appendFile(logFile, logLine, 'utf8');
    } catch (error) {
      console.error('❌ Error escribiendo log:', error.message);
    }

    // Console log siempre disponible
    console.log(`[${level}] ${message}`, data || '');
  }

  async info(message, data = null) {
    await this.log('INFO', message, data);
  }

  async error(message, data = null) {
    await this.log('ERROR', message, data);
  }

  async warn(message, data = null) {
    await this.log('WARN', message, data);
  }

  async debug(message, data = null) {
    await this.log('DEBUG', message, data);
  }
}

module.exports = new QueueLogger();