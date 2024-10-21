/**
 * Builder plugin for compressing of files using both of gzip and brotli algorithms
 * Pushes into file stream nothing but compressed versions of minified files to be written into output directory
 * to avoid unnecessary files rewriting
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const path = require('path');

module.exports = function declarePlugin(moduleInfo, flushMode = false) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         if (
            !flushMode &&
            moduleInfo.compiledFiles &&
            (file.pPath.endsWith('.js') || file.pPath.endsWith('.json') || file.pPath.endsWith('.less'))
         ) {
            const clonedFile = file.clone();
            Object.defineProperty(clonedFile, 'cachedJsFile', { value: true });

            moduleInfo.compiledFiles.push(clonedFile);


            const currentRelativePath = `${moduleInfo.name}/${file.pRelative}`;
            if (currentRelativePath.includes('/lang/')) {
               const locale = path.basename(path.dirname(file.pPath));
               const region = file.pStem;

               if (region !== locale) {
                  callback(null);
                  return;
               }
            }
         }

         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         if (flushMode && moduleInfo.compiledFiles) {
            moduleInfo.compiledFiles.forEach(file => this.push(file));
            delete moduleInfo.compiledFiles;
         }

         callback();
      }
   );
};
