/**
 * Builder plugin for icons analizing. Process each icon and generate list of fonts to build
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const logger = require('../../../lib/logger').logger();
const fs = require('fs-extra');
const { getIconInfoByPath, addLangInContents } = require('../../../lib/icons/helpers');

// копируем модуль с региональными настройками в региональный output
// в него потом будем копировать региональные иконки и собирать региональный
// шрифт.
const copyRegionModule = (() => {
   let copied = false;
   return async(from, to) => {
      if (!copied) {
         await fs.copy(from, to);
         copied = true;
      }
   };
})();

function addFontToGenerate(fontsToGenerate, fontName, svgSourcesPath, region) {
   if (!fontsToGenerate[fontName]) {
      fontsToGenerate[fontName] = { svgSourcesPath };
      fontsToGenerate[`${fontName}_compatible`] = { svgSourcesPath };
   } else {
      fontsToGenerate[fontName].svgSourcesPath = svgSourcesPath;
      fontsToGenerate[`${fontName}_compatible`].svgSourcesPath = svgSourcesPath;
   }

   if (region) {
      fontsToGenerate[fontName].region = region;
      fontsToGenerate[`${fontName}_compatible`].region = region;
   }

   fontsToGenerate[`${fontName}_compatible`].originFontName = fontName;
}

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
               let iconOutput;

               // если в данной сборке несколько регионов и мы нашли региональную иконку, удовлетворяющую
               // параметрам сборки, нам необходимо сгенерировать отдельный шрифт с данной региональной иконкой
               // в отдельном региональном output.
               if (iconInfo.region && taskParameters.config.countries.length > 1) {
                  await copyRegionModule(
                     moduleInfo.output,
                     moduleInfo.regionOutput[iconInfo.region]
                  );

                  iconOutput = `${moduleInfo.regionOutput[iconInfo.region]}/${iconInfo.relative}`;

                  await fs.copy(file.path, iconOutput);
                  addFontToGenerate(
                     fontsToGenerate,
                     iconInfo.fontName,
                     iconInfo.svgSourcesPath,
                     iconInfo.region
                  );
               } else {
                  // если в данной сборке только 1 регион, нет смысла генерировать отдельный
                  // региональный шрифт в отдельном output, поскольку дефолтный output уже
                  // является региональным.
                  iconOutput = iconInfo.copy;

                  await fs.copy(file.path, iconInfo.copy);
               }

               logger.debug(`Icon ${file.path} copied to ${iconOutput}`);
            }

            if (iconInfo.fontName) {
               const { fontName, svgSourcesPath, language } = iconInfo;

               if (language) {
                  addFontToGenerate(
                     fontsToGenerate,
                     `${fontName}-${language}`,
                     svgSourcesPath
                  );
                  addLangInContents(moduleInfo, iconInfo);
               } else {
                  addFontToGenerate(
                     fontsToGenerate,
                     fontName,
                     svgSourcesPath
                  );
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
