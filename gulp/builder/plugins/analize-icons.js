/**
 * Builder plugin for icons analizing. Process each icon and generate list of fonts to build
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const logger = require('../../../lib/logger').logger();
const fs = require('fs-extra');
const { getIconInfoByPath, addLangInContents } = require('../../../lib/icons/helpers');

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - a whole parameters list for execution of build of current project
 * @param {ModuleInfo} moduleInfo - all needed information about current interface module
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo, fontsToGenerate) {
   const { langs, countries } = taskParameters.config;
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!file.contents) {
               callback();
               return;
            }
            const iconInfo = getIconInfoByPath(
               { langs, countries },
               moduleInfo,
               file
            );

            if (iconInfo.ignore) {
               callback();
               return;
            }

            if (iconInfo.move) {
               await fs.move(file.path, iconInfo.move);
               logger.debug(`Icon ${file.path} moved to ${iconInfo.move}`);
               callback();
               return;
            }

            if (iconInfo.copy) {
               await fs.copy(iconInfo.copy, file.path);
               logger.debug(`Icon ${file.path} copied to ${iconInfo.copy}`);
            }

            if (iconInfo.fontName) {
               const { fontName, svgSourcesPath, language } = iconInfo;

               if (language) {
                  fontsToGenerate[`${fontName}-${language}`] = svgSourcesPath;
                  addLangInContents(moduleInfo, iconInfo);
               } else {
                  fontsToGenerate[fontName] = svgSourcesPath;
               }
            }
         } catch (error) {
            logger.error({
               message: "Builder's error occurred in 'analizeIcons' task",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }

         callback();
      }
   );
};
