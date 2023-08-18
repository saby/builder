/**
 * Builder plugin for icons analizing. Process each icon and generate list of fonts to build
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2');
const logger = require('../../../lib/logger').logger();
const fs = require('fs-extra');

function getLangIconInfo(langs, root, iconParts) {
   const [, language, fontName] = iconParts;

   // ignore icons without specific namespace or icons for
   // disabled languages
   if (!fontName || !langs.includes(language)) {
      return { ignore: true };
   }

   return {
      fontName,
      svgSourcesPath: path.join(root, 'lang', language, fontName),
      language
   };
}

function getRegionIconInfo(localizationMeta, root, iconParts) {
   const { langs, countries } = localizationMeta;
   const [, region] = iconParts;

   // ignore icons without specific namespace or icons for
   // disabled languages
   if (!iconParts[2] || !countries.includes(region)) {
      return { ignore: true };
   }

   if (iconParts[2] !== 'lang') {
      // ignore nested folders
      // e.g. MyModule/region/KZ/sort/icon.svg - good
      // MyModule/region/KZ/sort/myIcon/icon.svg - bad
      if (iconParts[3] && iconParts[3].endsWith('.svg')) {
         return {
            copy: path.join(root, iconParts[2], iconParts[3]),
            fontName: iconParts[2],
            svgSourcesPath: path.join(root, iconParts[2])
         };
      }
      return { ignore: true };
   }

   const language = iconParts[3];

   if (!langs.includes(language)) {
      return { ignore: true };
   }

   // ignore svg without font namespace inside of lang folder of specific region
   // e.g. MyModule/region/KZ/lang/en/icon.svg
   if (iconParts[4].endsWith('.svg')) {
      return { ignore: true };
   }

   const currentNamespace = iconParts[4];

   // ignore nested folders
   // e.g. MyModule/region/KZ/lang/sort/icon.svg - good
   // MyModule/region/KZ/lang/sort/myIcon/icon.svg - bad
   if (iconParts[5] && iconParts[5].endsWith('.svg')) {
      return {
         copy: path.join(root, 'lang', language, currentNamespace, iconParts[5]),
         fontName: currentNamespace,
         svgSourcesPath: path.join(root, 'lang', language, currentNamespace),
         language
      };
   }
   return { ignore: true };
}

function getIconInfoByPath(localizationMeta, moduleInfo, file) {
   const iconParts = file.pRelative.split('/');

   // ignore root icons
   if (iconParts.length === 1) {
      return {
         ignore: true
      };
   }


   const sizeKBites = file.stat.size / 1024;

   // temporary move large icons into 'moved' folder. Font generator don't use
   // nested directories of svg icons to generate font
   if (sizeKBites > 50) {
      logger.info(
         `icon ${moduleInfo.outputName}/${file.pRelative} exceeds maximum size of 50 KBites` +
         `(current size - ${sizeKBites}). Icon will not be included in font!`
      );
      return {
         move: `${path.join(path.dirname(file.path), 'moved', file.basename)}`
      };
   }

   if (iconParts[0] === 'lang') {
      return getLangIconInfo(localizationMeta.langs, moduleInfo.output, iconParts);
   }

   if (iconParts[0] === 'region') {
      return getRegionIconInfo(localizationMeta, moduleInfo.output, iconParts);
   }

   // ignore svg icons in nested directories
   // e.g. Controls-icons/actions/someAnotherFolder/icon-smth.svg
   // Unfortunately, font generator skips nested folders while generating fonts
   if (iconParts.length > 2) {
      return { ignore: true };
   }

   return {
      fontName: iconParts[0],
      svgSourcesPath: path.dirname(file.pPath)
   };
}

function addLangInContents(moduleInfo, iconInfo) {
   const { fontName, language } = iconInfo;
   if (moduleInfo.contents) {
      const currentMeta = moduleInfo.contents.modules[moduleInfo.outputName];
      if (!currentMeta.icons) {
         currentMeta.icons = {};
      }
      if (!currentMeta.icons.hasOwnProperty(fontName)) {
         currentMeta.icons[fontName] = [language];
      } else if (!currentMeta.icons[fontName].includes(language)) {
         currentMeta.icons[fontName].push(language);
      }
   }
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
