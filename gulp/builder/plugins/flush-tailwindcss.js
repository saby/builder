/**
 * @author Krylov M.A.
 */

'use strict';

const through = require('through2');

const PosixVinyl = require('../../../lib/platform/vinyl');
const modifyTailwindCSS = require('../../../lib/tailwind/replace-css');

module.exports = function declarePlugin(moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         if (moduleInfo.tailwindInfoChanged) {
            const file = new PosixVinyl({
               pBase: moduleInfo.path,
               pPath: moduleInfo.tailwindInfo.outputFile,
               contents: Buffer.from(moduleInfo.tailwindInfo.outputFileContents),
               stat: {
                  mtime: new Date().toString()
               },
               strictCopy: true,
               compiled: true
            });

            if (moduleInfo.tailwindInfo.replacers) {
               const contents = modifyTailwindCSS(
                  moduleInfo.tailwindInfo.snapshot,
                  moduleInfo.tailwindInfo.replacers.rules
               );

               if (contents) {
                  file.contents = Buffer.from(contents);
               }
            }

            this.push(file);
         }

         callback();
      }
   );
};
