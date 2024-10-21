/**
 * Плагин для обработки ресурсов локализации (словари и стили).
 * Если есть ресурсы локализации, то нужно записать <локаль>.js файл
 * в папку "lang/<локаль>" и занести данные в contents.json
 * Объединеям стили локализации в единый файл "lang/<локаль>/<локаль>.css".
 * Стили локализации могут быть в less.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const { moduleHasNoChanges } = require('../../../lib/helpers');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   DictionaryIndexer = require('../../../lib/i18n/dictionary-indexer');
const getMetricsReporter = require('../../common/classes/metrics-reporter');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   DictionaryIndexer.setDictionaryIndexer(
      moduleInfo.outputName,
      taskParameters.config.localizations,
      moduleInfo.dropLocalizationCache ? {} : moduleInfo.cache.getLocalizationMeta()
   );
   const indexer = DictionaryIndexer.indexer(moduleInfo.outputName);
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         try {
            // нам нужны только css и json локализации
            const locale = path.basename(path.dirname(file.pPath));
            if (
               !['.json', '.css', '.less'].includes(file.pExtname) ||
               !taskParameters.config.localizations.includes(locale) ||
               file.skipIndexDictionary
            ) {
               taskParameters.metrics.storePluginTime('index localization dictionary', startTime);
               callback(null, file);
               return;
            }

            if (file.pExtname === '.json') {
               const region = file.pStem;
               const isDefaultLocale = region === locale;
               indexer.addLocalizationJson(
                  moduleInfo.path,
                  file.pPath,
                  locale,
                  isDefaultLocale ? null : region,
                  JSON.parse(file.contents)
               );

               /**
                * specific region locales is needed only for generating
                * merged region and default locales
                */
               if (!isDefaultLocale) {
                  taskParameters.metrics.storePluginTime('index localization dictionary', startTime);
                  callback(null);
                  return;
               }
            } else if (file.pExtname === '.css' || file.pExtname === '.less') {
               const prettyRelativePath = file.pRelative;

               /**
                * css locales in root lang aren't allowed. All this sources will be merged into root lang css content.
                * That's why source lang css can't be described in the root lang directory, for this case use less.
                */
               if (prettyRelativePath === `lang/${locale}/${locale}.css` && file.pHistory.length === 1) {
                  logger.error({
                     message: 'Attempt to use css from root lang directory, use less instead!',
                     filePath: file.pPath,
                     moduleInfo
                  });
                  taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
                  getMetricsReporter().markFailedModule(moduleInfo);
               }
               indexer.addLocalizationCSS(file.pPath, locale, file.contents.toString());
            }
         } catch (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo,
               filePath: file.pPath
            });
         }

         taskParameters.metrics.storePluginTime('index localization dictionary', startTime);
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();

         // если changedFiles и deletedFiles не переданы, значит локализация всегда собирается.
         // А если переданы, нужно проверить, не было ли признака сброса кеша локализации или не было ли
         // изменений в самой локализации и если не было, нет смысла мержить словари и писать региональные версии
         if (moduleHasNoChanges(
            moduleInfo,
            [moduleInfo.localizationChanged]
         )) {
            callback(null);
            return;
         }

         try {
            for (const locale of taskParameters.config.localizations) {
               const mergedCSSCode = indexer.extractMergedCSSCode(moduleInfo.output, locale);
               if (mergedCSSCode) {
                  const mergedCSSPath = path.join(moduleInfo.output, 'lang', locale, `${locale}.css`);
                  this.push(
                     new PosixVinyl({
                        pBase: moduleInfo.output,
                        pPath: mergedCSSPath,
                        contents: Buffer.from(mergedCSSCode),
                        unitedDict: true
                     })
                  );
               }
               const mergedDictionary = indexer.extractMergedDicts(locale);
               if (mergedDictionary) {
                  Object.keys(mergedDictionary).forEach((currentRegion) => {
                     const regionDictPath = path.join(
                        moduleInfo.output,
                        'lang',
                        locale,
                        currentRegion.includes('-') ? `${currentRegion}.json` : `${locale}-${currentRegion}.json`
                     );
                     this.push(
                        new PosixVinyl({
                           pBase: moduleInfo.output,
                           pPath: regionDictPath,
                           contents: Buffer.from(JSON.stringify(mergedDictionary[currentRegion])),
                           history: [regionDictPath, regionDictPath],
                           unitedDict: true
                        })
                     );
                  });
               }
            }
         } catch (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }

         moduleInfo.cache.storeLocalizationMeta(DictionaryIndexer.indexer(moduleInfo.outputName));
         taskParameters.metrics.storePluginTime('index localization dictionary', startTime);
         callback();
      }
   );
};
