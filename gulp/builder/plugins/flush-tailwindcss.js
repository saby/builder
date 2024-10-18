/**
 * @author Krylov M.A.
 */

'use strict';

const through = require('through2');

const PosixVinyl = require('../../../lib/platform/vinyl');

module.exports = function declarePlugin(moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         if (moduleInfo.tailwindInfoChanged) {
            this.push(new PosixVinyl({
               pBase: moduleInfo.path,
               pPath: moduleInfo.tailwindInfo.outputFile,
               contents: Buffer.from(moduleInfo.tailwindInfo.outputFileContents),
               stat: {
                  mtime: new Date().toString()
               },
               strictCopy: true,
               compiled: true
            }));
         }

         callback();
      }
   );
};
