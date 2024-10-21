'use strict';

const transliterate = require('../lib/transliterate');
const fs = require('fs-extra');
const { path } = require('./platform/path');
const { TS_EXT } = require('./builder-constants');
const { hoistTopComment } = require('./es-converter/helpers');

async function loadSourceMap(sourceMaps, jsMapFilePath) {
   if (!sourceMaps) {
      return '';
   }

   if (await fs.pathExists(jsMapFilePath)) {
      return fs.readFile(jsMapFilePath, { encoding: 'utf-8' });
   }

   return '';
}

async function loadCompiledJs(typescriptOutputDir, relativePath, tsxContents, sourceMaps) {
   const moduleName = transliterate(relativePath).replace(TS_EXT, '');
   const jsFilePath = path.join(
      typescriptOutputDir,
      relativePath.replace(/\.tsx?$/, '.js')
   );
   const jsMapFilePath = path.join(
      typescriptOutputDir,
      relativePath.replace(/\.tsx?$/, '.js.map')
   );
   const jsContents = await fs.readFile(jsFilePath, { encoding: 'utf-8' });
   const sourceMapText = await loadSourceMap(sourceMaps, jsMapFilePath);
   const text = hoistTopComment(tsxContents, jsContents);

   return {
      moduleName,
      text,
      sourceMapText
   };
}

module.exports = loadCompiledJs;
