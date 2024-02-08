/**
 * Plugin to add all missing themes with its content into common
 * build stream
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const PosixVinyl = require('../../../lib/platform/vinyl');
const through = require('through2');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo = null) {
   let missingThemesAdded = false;
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         if (missingThemesAdded) {
            callback(null, file);
            return;
         }
         const missingThemes = taskParameters.cache.getMissingThemes();

         Object.keys(missingThemes)
            .forEach((currentTheme) => {
               if (currentTheme.startsWith(path.join(moduleInfo.path, path.sep))) {
                  this.push(
                     new PosixVinyl({
                        pBase: moduleInfo.path,
                        pPath: path.join(currentTheme, 'theme.less'),
                        contents: Buffer.from(missingThemes[currentTheme]),
                        stat: {
                           mtime: new Date().toString()
                        },
                        strictCopy: true
                     })
                  );
               }
            });
         missingThemesAdded = true;
         callback(null, file);
      }
   );
};
