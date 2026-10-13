'use strict';

function write(level, moduleName, event, fields = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    module: moduleName,
    event,
    ...fields,
  };
  const target = level === 'error' ? console.error : console.log;
  target(JSON.stringify(payload));
  return payload;
}

function createLogger(moduleName) {
  return {
    info: (event, fields) => write('info', moduleName, event, fields),
    warn: (event, fields) => write('warn', moduleName, event, fields),
    error: (event, fields) => write('error', moduleName, event, fields),
  };
}

module.exports = { createLogger, write };
