// transpile modules at runtime
require('@babel/register');
module.exports = require('./lib/index.js').default;
