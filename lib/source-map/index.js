/**
 * Модуль для работы с source map.
 * @author Krylov M.A.
 */

'use strict';

const { getSourceRoot, toComment, fromComment } = require('./helpers');
const { generateSourceMap } = require('./generator');
const SourceMapModifier = require('./modifier');

module.exports = {
   getSourceRoot,
   toComment,
   fromComment,
   generateSourceMap,
   SourceMapModifier
};
