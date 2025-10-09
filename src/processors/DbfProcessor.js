class DbfProcessor {
  constructor(payload) {
    this.payload = payload;
  }

  process() {
    const { records, ...topMeta } = this.payload;
    
    return records.map(record => {
      const { __meta = {}, ...recordData } = record;
      
      return {
        ...recordData,
        __meta: {
          ...topMeta,
          ...__meta
        }
      };
    });
  }
}

module.exports = DbfProcessor;
