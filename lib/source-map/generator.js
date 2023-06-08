/**
 * Модуль генерации source map для случая generated = source.
 * @author Krylov M.A.
 */

'use strict';

const { SourceMapGenerator } = require('source-map');
const { tokenize } = require('espree');

function generateSourceMap(sourceContent, sourceFile, sourceRoot, shouldSetSourceContent) {
   const generator = new SourceMapGenerator({
      file: sourceFile,
      sourceRoot
   });

   const tokens = tokenize(sourceContent, {
      loc: true,
      comment: true,
      ecmaVersion: 2021
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

   return generator.toJSON();
}

module.exports = {
   generateSourceMap
};
