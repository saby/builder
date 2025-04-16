/**
 * Модуль генерации source map для случая generated = source.
 * @author Krylov M.A.
 */

'use strict';

const { SourceMapGenerator } = require('source-map');
const { tokenize } = require('espree');

function generateSourceMap(sourceContent, sourceRoot, sourceFile, fileName, shouldSetSourceContent) {
   const generator = new SourceMapGenerator({
      file: fileName,
      sourceRoot
   });

   // FIXME: Вместо 2021 используем 2019. После завершения проекта, вернуть обратно
   //   https://online.sbis.ru/opendoc.html?guid=275e9e3b-1973-44a9-af21-f922019564fd&client=3
   const tokens = tokenize(sourceContent, {
      loc: true,
      comment: true,
      ecmaVersion: 2019
   });

   for (const token of tokens) {
      const mapping = {
         original: token.loc.start,
         generated: token.loc.start,
         source: sourceFile
      };

      if (token.type.label === 'name') {
         mapping.name = token.value;
      }

      generator.addMapping(mapping);
   }

   if (shouldSetSourceContent) {
      generator.setSourceContent(sourceFile, sourceContent);
   }

   const sourceMapJson = generator.toJSON();

   sourceMapJson.file = fileName;
   sourceMapJson.sourceRoot = sourceRoot;
   sourceMapJson.sources = [sourceFile];

   return sourceMapJson;
}

module.exports = {
   generateSourceMap
};
