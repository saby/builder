/**
 * Builder plugin for icons analizing. Process each icon and generate list of fonts to build
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const logger = require('../../../lib/logger').logger();
const fs = require('fs-extra');
const { getIconInfoByPath, addLangInContents } = require('../../../lib/icons/helpers');
const getMetricsReporter = require('../../common/classes/metrics-reporter');
const { ICON_DIMENSIONS } = require('../../../lib/builder-constants');
const ICON_DIMENSIONS_LIST = Object.keys(ICON_DIMENSIONS)
   .map(dimensionValue => ICON_DIMENSIONS[dimensionValue]);
const assert = require('assert');

// наполняем мету о составе иконок для каждого шрифта. Если у нас один
//  шрифт с разными размерностями, учитываем это в мете. Например
// {
//    accordion: { s: <список иконок шрифта accordion_s>, m: <список иконок шрифта accordion_m> },
//    designtime: {}
// }
// сответственно если для конкретного шрифта пустой обьект, значит для данного шрифта только 1 размер
// и проверять его не надо.
function storeFontIntoFontMeta(commonFontsMeta, iconName, fontName) {
   const [commonFontName, possibleDimension] = fontName.split('_');

   if (!commonFontsMeta[commonFontName]) {
      commonFontsMeta[commonFontName] = {};
   }

   if (possibleDimension) {
      if (ICON_DIMENSIONS_LIST.includes(possibleDimension)) {
         if (!commonFontsMeta[commonFontName][possibleDimension]) {
            commonFontsMeta[commonFontName][possibleDimension] = new Set([]);
         }
         commonFontsMeta[commonFontName][possibleDimension].add(iconName);
      }
   }
}

// добавляем шрифт в массив регионов для дальнейшей сборки множества региональных шрифтов
// обычно в сборке не может быть больше одного региона, но online-inside является
// единственным исключением, там собирается единый монолит из всех регионов, а только потом
// jinnee региональные ресурсы разбивает по дистрибутивам, поэтому задаём именно массив регионов
function addRegionToGeneratingFonts(currentFontMeta, region) {
   if (!currentFontMeta.region) {
      currentFontMeta.region = [];
   }

   if (!currentFontMeta.region.includes(region)) {
      currentFontMeta.region.push(region);
   }
}

function addFontToGenerate(commonFontsMeta, fontsToGenerate, iconName, fontName, svgSourcesPath, region) {
   storeFontIntoFontMeta(commonFontsMeta, iconName, fontName);
   if (!fontsToGenerate[fontName]) {
      fontsToGenerate[fontName] = { svgSourcesPath };
      fontsToGenerate[`${fontName}_compatible`] = { svgSourcesPath };
   } else {
      fontsToGenerate[fontName].svgSourcesPath = svgSourcesPath;
      fontsToGenerate[`${fontName}_compatible`].svgSourcesPath = svgSourcesPath;
   }

   if (region) {
      addRegionToGeneratingFonts(fontsToGenerate[fontName], region);
      addRegionToGeneratingFonts(fontsToGenerate[`${fontName}_compatible`], region);
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

   // здесь будем хранить базовую мету по шрифтам - имена шрифтов и их размерности
   // это нужно, чтобы определить, соответствует ли друг другу состав шрифтов разных
   // размерностей - очень важное правило, чтобы у одного шрифта разных размеров(например
   // s и m) был одинаковый состав иконок, чтобы на клиенте при одновременной загрузке
   // данного списка шрифтов не было расхождений.
   const commonFontsMeta = {};
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

            // тут обрабатываем только основные иконки модуля, обработка региональных иконок и их копирование
            // в региональный output идёт дальше
            if (taskParameters.config.countries.length > 1 && !iconInfo.region) {
               const promises = [];

               // нужно копировать иконки пофайлово в региональный output, чтобы сгенерировать региональную
               // версию шрифта. Копировать весь модуль через fs.copy оказалось плохой практикой, у ноды иногда
               // при выполнении данного метода падает ошибка "Source and destination must not be the same"
               // https://github.com/jprichardson/node-fs-extra/issues/657
               // и она возникает, если output-директория, куда происходит копирование, уже существует.
               taskParameters.config.countries.forEach(
                  currentRegion => promises.push(
                     fs.copy(
                        file.path,
                        `${moduleInfo.regionOutput[currentRegion]}/${file.pRelative}`
                     )
                  )
               );

               await Promise.all(promises);
            }

            if (iconInfo.copy) {
               let iconOutput;

               // если в данной сборке несколько регионов и мы нашли региональную иконку, удовлетворяющую
               // параметрам сборки, нам необходимо сгенерировать отдельный шрифт с данной региональной иконкой
               // в отдельном региональном output.
               if (iconInfo.region && taskParameters.config.countries.length > 1) {
                  iconOutput = `${moduleInfo.regionOutput[iconInfo.region]}/${iconInfo.relative}`;

                  await fs.copy(file.path, iconOutput);
                  addFontToGenerate(
                     commonFontsMeta,
                     fontsToGenerate,
                     file.pBasename,
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
                     commonFontsMeta,
                     fontsToGenerate,
                     file.pBasename,
                     `${fontName}-${language}`,
                     svgSourcesPath
                  );
                  addLangInContents(moduleInfo, iconInfo);
               } else {
                  addFontToGenerate(
                     commonFontsMeta,
                     fontsToGenerate,
                     file.pBasename,
                     fontName,
                     svgSourcesPath
                  );
               }
            }
         } catch (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: "Builder's error occurred in 'analizeIcons' task",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }

         callback();
      },

      function onFlush(callback) {
         Object.keys(commonFontsMeta).forEach((currentFont) => {
            const currentDimensions = Object.keys(commonFontsMeta[currentFont]);

            if (currentDimensions.length <= 1) {
               return;
            }

            // шрифты всех размерностей должны друг с другом совпадать по составу иконок,
            // иначе на клиенте можем получать кривые шрифты при одновременной загрузки двух
            // шрифтов(например accordion_st и accordion_m)
            for (let i = 0; i < currentDimensions.length; i++) {
               for (let j = i + 1; j < currentDimensions.length; j++) {
                  const firstFont = commonFontsMeta[currentFont][currentDimensions[i]];
                  const secondFont = commonFontsMeta[currentFont][currentDimensions[j]];

                  // если какой то размерности нет, пропускаем проверку.
                  try {
                     assert.deepStrictEqual([...firstFont].sort(), [...secondFont].sort());
                  } catch (e) {
                     const errorMessage = {
                        message: `У шрифта ${currentFont} отличается состав иконок у размеров ` +
                           `${currentDimensions[i]}(${firstFont.size}) и ` +
                           `${currentDimensions[j]}(${secondFont.size}) : ${e.message}`,
                        moduleInfo
                     };

                     logger.error(errorMessage);
                  }
               }
            }
         });

         callback();
      }
   );
};
