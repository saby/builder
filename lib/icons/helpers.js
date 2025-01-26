'use strict';
const path = require('path').posix;
const logger = require('../logger').logger();

function getLangIconInfo(langs, root, iconParts) {
   const [, language, fontName] = iconParts;

   // ignore icons without specific namespace or icons for
   // disabled languages
   if (!fontName || !langs.includes(language)) {
      return { ignore: true };
   }

   // ignore svg without font namespace inside of lang folder
   // e.g. MyModule/lang/en/icon.svg
   if (iconParts[2].endsWith('.svg')) {
      return { ignore: true };
   }

   // ignore nested folders
   // e.g. MyModule/lang/en/sort/icon.svg - good
   // MyModule/lang/en/sort/myIcon/icon.svg - bad
   if (iconParts[3] && iconParts[3].endsWith('.svg')) {
      return {
         fontName,
         svgSourcesPath: path.join(root, 'lang', language, fontName),
         language
      };
   }

   return { ignore: true };
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
            relative: path.join(iconParts[2], iconParts[3]),
            fontName: iconParts[2],
            svgSourcesPath: path.join(root, iconParts[2]),
            region
         };
      }
      return { ignore: true };
   }

   const language = iconParts[3];

   if (!langs.includes(language)) {
      return { ignore: true };
   }

   // ignore svg without font namespace inside lang folder of specific region
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
         relative: path.join('lang', language, currentNamespace, iconParts[5]),
         fontName: currentNamespace,
         svgSourcesPath: path.join(root, 'lang', language, currentNamespace),
         language,
         region
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


   // file stats are available only for read files
   if (file.stat) {
      const sizeKBites = file.stat.size / 1024;

      // temporary move large icons into 'moved' folder. Font generator don't use
      // nested directories of svg icons to generate font
      if (sizeKBites > 50) {
         logger.info(
            `icon ${moduleInfo.outputName}/${file.pRelative} exceeds maximum size of 50 KBites` +
            `(current size - ${sizeKBites}). Icon will not be included in font!`
         );
         return {
            move: `${path.join(path.dirname(file.pPath), 'moved', file.pBasename)}`
         };
      }
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

module.exports = {
   getLangIconInfo,
   getIconInfoByPath,
   getRegionIconInfo,
   addLangInContents
};
