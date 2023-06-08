/**
 * @author Krylov M.A.
 */

'use strict';

const through = require('through2');

module.exports = function declarePlugin(moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         if (file.pBasename === 'tailwind.css' && typeof moduleInfo.tailwindCssContents === 'string') {
            file.contents = Buffer.from(moduleInfo.tailwindCssContents);
         }

         callback(null, file);
      }
   );
};
