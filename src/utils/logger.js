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
//     const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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

//     // También mostrar en consola
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

// module.exports = new QueueLogger();

const fs = require('fs').promises;
const path = require('path');

class QueueLogger {
  constructor(logsDir = './logs') {
    this.logsDir = logsDir;
    console.log('🔧 Logger inicializado - Carpeta:', this.logsDir);
    this.setupLogsDirectory();
  }

  async setupLogsDirectory() {
    try {
      console.log('📁 Intentando crear carpeta de logs...');
      await fs.mkdir(this.logsDir, { recursive: true });
      console.log('✅ Carpeta de logs creada exitosamente:', this.logsDir);
    } catch (error) {
      console.error('❌ Error creando carpeta de logs:', error);
    }
  }

  async log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp} [${level}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
    
    console.log('📝 Intentando escribir log:', logLine);
    
    try {
      const logFile = path.join(this.logsDir, this.getLogFileName());
      console.log('💾 Archivo de log:', logFile);
      
      await fs.appendFile(logFile, logLine, 'utf8');
      console.log('✅ Log escrito exitosamente');
    } catch (error) {
      console.error('❌ Error escribiendo log:', error);
    }
  }

  getLogFileName() {
    const date = new Date().toISOString().split('T')[0];
    return `queue_${date}.log`;
  }

  // ... resto de métodos igual
}

module.exports = new QueueLogger();