/**
 * Плагин для обработки *.sabytheme
 * Определение ключей
 * 1)is_parent - от этой темы кто-то уже наследуется
 * 2)parent - тема, от которой наследуемся. Все селекторы и проперти текущей темы мы переопределяем
 * только если они описаны в overrides все остальное берём из родительской темы.
 * У родительской темы также допускается наличие parent, поэтому придётся резолвить и строить темы
 * рекурсивно
 *
 * Как строится css-селектор:
 * .t-<свойство 'selector' в body>.<свойство 'selector' каждого элемента поля 'styles'> {
 *    --<поле key в каждом элементе styles>: <hsl(a) to hex(a) значение полей элемента styles>
 * }
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../../lib/logger').logger();
const through = require('through2');
const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const minifyCss = require('../../../lib/run-minify-css');
const {
   getProcessedThemes,
   convertSabyThemeMetaToCss,
   parseTheme,
   getJsonMetaForSabyTheme
} = require('../../../lib/process-sabytheme');

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         if (!file.contents) {
            callback();
            taskParameters.metrics.storePluginTime('sabyTheme', startTime);
            return;
         }

         if (!file.pBasename.endsWith('.sabytheme')) {
            callback(null, file);
            taskParameters.metrics.storePluginTime('sabyTheme', startTime);
            return;
         }

         try {
            const parsedSabyTheme = parseTheme(`${moduleInfo.outputName}/${file.basename}`, JSON.parse(file.contents.toString()));

            moduleInfo.cache.storeSabyTheme(parsedSabyTheme.id, parsedSabyTheme);
         } catch (error) {
            logger.error({
               message: 'An error occurred during parsing of sabytheme',
               filePath: file.path,
               moduleInfo,
               error
            });
         }

         taskParameters.metrics.storePluginTime('saby themes', startTime);
         callback(null, file);
      },

      /* @this Stream */
      async function onFlush(callback) {
         const startTime = Date.now();
         try {
            const promises = [];
            const sabyThemes = getProcessedThemes(moduleInfo.cache.getSabyThemes());

            Object.keys(sabyThemes).forEach((currentTheme) => {
               const relativeOutputPathWoExt = `sabythemes/${sabyThemes[currentTheme].selector}`;
               const outputPathWoExt = path.join(
                  taskParameters.config.outputPath,
                  'ThemesModule',
                  relativeOutputPathWoExt
               );
               const cssResult = convertSabyThemeMetaToCss(sabyThemes[currentTheme]);
               const jsonResult = getJsonMetaForSabyTheme(sabyThemes[currentTheme]);

               taskParameters.addFileToCopy('ThemesModule', `${relativeOutputPathWoExt}.css`);
               taskParameters.addFileToCopy('ThemesModule', `${relativeOutputPathWoExt}.json`);
               if (taskParameters.config.minimize) {
                  const minifiedCss = minifyCss(true, cssResult);

                  promises.push(fs.outputFile(`${outputPathWoExt}.min.css`, minifiedCss.styles));
                  taskParameters.addFileToCopy('ThemesModule', `${relativeOutputPathWoExt}.min.css`);
               }

               if (taskParameters.config.version) {
                  taskParameters.addVersionedModule('ThemesModule', `ThemesModule/${relativeOutputPathWoExt}.css`);

                  if (taskParameters.config.minimize) {
                     taskParameters.addVersionedModule('ThemesModule', `ThemesModule/${relativeOutputPathWoExt}.min.css`);
                  }
               }

               promises.push(fs.outputFile(`${outputPathWoExt}.css`, cssResult));
               promises.push(fs.outputJson(`${outputPathWoExt}.json`, jsonResult));
            });

            await Promise.all(promises);
         } catch (error) {
            logger.error({
               message: 'An error occurred during generate sabytheme to css',
               moduleInfo,
               error
            });
         }

         taskParameters.metrics.storePluginTime('saby themes', startTime);
         callback();
      }
   );
};
