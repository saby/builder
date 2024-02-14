/**
 * Модуль вспомогательных функций для работы с source map.
 * @author Krylov M.A.
 */

'use strict';

const fs = require('fs-extra');
const { path } = require('../platform/path');

async function getSourceRoot(filePath) {
   // real path might lead to shared volume (win32 shared, docker mounted)
   // and fs.promises.realpath will fail
   try {
      return path.dirname(await fs.promises.realpath(filePath));
   } catch (e) {
      return path.dirname(filePath);
   }
}

function toComment(jsonSourceMap) {
   const data = Buffer.from(JSON.stringify(jsonSourceMap)).toString('base64');

   return `//# sourceMappingURL=data:application/json;base64,${data}`;
}

function fromComment(jsonSourceMapComment) {
   const sourceMappingURLRe = /^[@#]\s+?sourceMappingURL=data:(((?:application|text)\/json)(?:;charset=([^;,]+?)?)?)?(?:;(base64))?,(.*?)$/m;

   if (!sourceMappingURLRe.test(jsonSourceMapComment)) {
      return undefined;
   }

   const re = sourceMappingURLRe.exec(jsonSourceMapComment);
   const base64Data = re && re[5];

   return JSON.parse(Buffer.from(base64Data, 'base64'));
}

module.exports = {
   getSourceRoot,
   toComment,
   fromComment
};
