// use esm to transpile es-modules at runtime
module.exports = require('esm')(module)('./lib/index.js').default;
