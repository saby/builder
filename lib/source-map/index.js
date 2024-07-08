/**
 * Модуль для работы с source map.
 * @author Krylov M.A.
 */

'use strict';

const { toComment, fromComment, createSourceMapPaths } = require('./helpers');
const { generateSourceMap } = require('./generator');
const SourceMapModifier = require('./modifier');

module.exports = {
   toComment,
   fromComment,
   generateSourceMap,
   createSourceMapPaths,
   SourceMapModifier
};
