'use strict';

const through = require('through2');
const PosixVinyl = require('../../../lib/platform/vinyl');

module.exports = function declarePlugin() {
   return through.obj((file, encoding, callback) => {
      callback(null, PosixVinyl.from(file));
   });
};
