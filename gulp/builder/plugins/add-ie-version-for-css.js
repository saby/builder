/**
 * Plugin for addition of ie version of css source file
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const Vinyl = require('vinyl');

/**
 * Plugin declaration
 * @returns {stream}
 */
module.exports = function declarePlugin(moduleInfo) {
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         const isMinifiedCss = file.history[0].endsWith('.min.css');

         // dont use symlinks for minified files in sources. It could cause EEXIST
         // error when there is an attempt to symlink it while compiled minified version
         // is already written in an output directory
         if (isMinifiedCss) {
            file.strictCopy = true;
         }
         if (file.extname === '.css' && file.history[0].endsWith('.css') && !isMinifiedCss) {
            this.push(
               new Vinyl({
                  base: moduleInfo.path,
                  path: file.path.replace('.css', '_ie.css'),
                  contents: file.contents,
                  stat: {
                     mtime: new Date().toString()
                  },
                  strictCopy: true
               })
            );
         }
         callback(null, file);
      }
   );
};
