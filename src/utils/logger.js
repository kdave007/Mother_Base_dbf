const fs = require('fs').promises;
const path = require('path');

class QueueLogger {
  constructor() {
    // Usar la misma lógica que SchemaService - path universal
    this.logsDir = path.join(__dirname, '../../logs');
    this.timezone = 'America/Mexico_City';
    this.setupLogsDirectory();
    console.log('📝 Logger configurado en:', this.logsDir);
    console.log('🌎 Timezone:', this.timezone);
  }

  /**
   * Obtiene la fecha/hora actual en timezone de México
   * @returns {Date} Fecha ajustada a America/Mexico_City
   */
  getMexicoTime() {
    const now = new Date();
    // Convertir a string en timezone de México y luego parsear de vuelta
    const mexicoTimeString = now.toLocaleString('en-US', { 
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    return mexicoTimeString;
  }

  /**
   * Formatea la fecha/hora en formato ISO-like para México
   * @returns {string} Timestamp formateado YYYY-MM-DD HH:mm:ss
   */
  getFormattedTimestamp() {
    const now = new Date();
    const options = {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };
    
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(now);
    
    const dateParts = {};
    parts.forEach(({ type, value }) => {
      dateParts[type] = value;
    });
    
    return `${dateParts.year}-${dateParts.month}-${dateParts.day} ${dateParts.hour}:${dateParts.minute}:${dateParts.second}`;
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

  /**
   * Genera el nombre del archivo de log basado en la fecha de México
   * @returns {string} Nombre del archivo (ej: queue_2025-11-04.log)
   */
  getLogFileName() {
    const now = new Date();
    const options = {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };
    
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(now);
    
    const dateParts = {};
    parts.forEach(({ type, value }) => {
      dateParts[type] = value;
    });
    
    const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    return `queue_${date}.log`;
  }

  async log(level, message, data = null) {
    const timestamp = this.getFormattedTimestamp();
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