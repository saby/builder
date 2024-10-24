/* eslint-disable consistent-this */
/**
 * Gulp plugin for creating of contents.json and contents.js meta files
 * (information for require.js, localization description, etc.)
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers');
const { generateWithStaticDependencies } = require('../../../lib/espree/convert-to-umd');
const DictionaryIndexer = require('../../../lib/i18n/dictionary-indexer');
const getMetricsReporter = require('../../common/classes/metrics-reporter');


function generateContentsContent(uiModuleName, sortedContents, generateUMD) {
   const factoryFunctionDecl = `function(){return ${sortedContents};}`;
   const moduleName = `${uiModuleName}/contents.json`;

   if (generateUMD) {
      return generateWithStaticDependencies({
         factoryFunctionCall: `define('${moduleName}', [], factory)`,
         factoryFunctionDecl
      });
   }

   return `define('${moduleName}',[],${factoryFunctionDecl});`;
}

function generateContentsFiles(stream, taskParameters, moduleInfo, fileName) {
   const sortedContents = JSON.stringify(moduleInfo.contents);
   const contentsBuffer = Buffer.from(sortedContents);
   const contentsJsContent = generateContentsContent(
      moduleInfo.outputName,
      sortedContents,
      taskParameters.config.generateUMD
   );
   const contentsJsonFile = new PosixVinyl({
      pPath: `${fileName}.json`,
      contents: contentsBuffer,
      moduleInfo,
      compiled: true
   });
   const contentsJsonJsFile = new PosixVinyl({
      pPath: `${fileName}.json.js`,
      contents: Buffer.from(contentsJsContent),
      moduleInfo,
      compiled: true
   });
   stream.push(contentsJsonJsFile);
   stream.push(contentsJsonFile);
   if (taskParameters.config.isReleaseMode) {
      const contentsMinJsonFile = new PosixVinyl({
         pPath: `${fileName}.min.json`,
         contents: contentsBuffer,
         moduleInfo,
         compiled: true
      });
      stream.push(contentsMinJsonFile);
      const contentsJsonMinJsFile = new PosixVinyl({
         pPath: `${fileName}.json.min.js`,
         contents: Buffer.from(contentsJsContent),
         moduleInfo,
         compiled: true
      });
      stream.push(contentsJsonMinJsFile);
   }
}

function generateContentsByDictionary(options) {
   const {
      stream, taskParameters, moduleInfo, contentsName, language, dictsIndexer
   } = options;

   // get dictionaries list by current language
   const dictsList = dictsIndexer.getDictionaryForContents(language).sort();

   if (dictsList.length > 0) {
      moduleInfo.contents.modules[moduleInfo.outputName].dict = dictsList;
   }
   generateContentsFiles(stream, taskParameters, moduleInfo, contentsName);
}

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         callback(null, file);
         taskParameters.metrics.storePluginTime('presentation service meta - contents.json', startTime);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         const moduleName = path.basename(moduleInfo.output);
         const dictsIndexer = DictionaryIndexer.indexer(moduleInfo.outputName);
         try {
            // подготовим contents.json и contents.js
            if (taskParameters.config.version) {
               moduleInfo.contents.buildnumber = moduleInfo.joinedMeta ? moduleInfo.version : `%{MODULE_VERSION_STUB=${moduleName}}`;
            }

            if (taskParameters.config.useReact) {
               moduleInfo.contents.useReact = true;
            }

            // write react mode into it's module contents
            if (moduleInfo.name === 'React') {
               moduleInfo.contents.modules[moduleInfo.runtimeModuleName].mode = taskParameters.cache.getReactMode();
            }

            if (taskParameters.config.extensionForTemplate) {
               moduleInfo.contents.extensionForTemplate = taskParameters.config.extensionForTemplate;
            }

            if (moduleInfo.ESVersion && moduleInfo.ESVersion !== taskParameters.config.ESVersion) {
               // ECSMAScript version for JIT compilation of wml/tmpl files in RJs plugins.
               moduleInfo.contents.modules[moduleInfo.runtimeModuleName].ESVersion = (
                  moduleInfo.ESVersion || taskParameters.config.ESVersion
               );
            } else {
               moduleInfo.contents.ESVersion = taskParameters.config.ESVersion;
            }

            // Set this property for only modules which contains dynamically generated tailwind.css file.
            // This information is vital in debug mode, because template compiler compiles templates without
            // tailwind dependency.
            if (moduleInfo.tailwindInfo) {
               moduleInfo.contents.modules[moduleInfo.runtimeModuleName].hasTailwind = true;
            }

            // save modular contents.js into joined if needed.
            if (taskParameters.config.joinedMeta) {
               helpers.joinContents(taskParameters.config.commonContents, moduleInfo.contents);
            }

            // Если мы собираемся по изменениям, то выхлоп мета-данных contents нужно
            // генерировать только при выполнении следующих условий:
            // 1) Есть изменения в локализации
            // 2) Есть изменения в tailwind.css выхлопе для конкретного модуля
            // 3) Есть события по сбросу кеша билдера или это сборка с нуля.
            const skipEmitContentsMeta = helpers.moduleHasNoChanges(
               moduleInfo,
               [moduleInfo.localizationChanged, moduleInfo.tailwindInfoChanged]
            );

            if (!skipEmitContentsMeta) {
               // sort contents first
               moduleInfo.contents = helpers.sortObject(moduleInfo.contents);

               const stream = this;
               if (taskParameters.config.localizedContents) {
                  taskParameters.config.localizations.forEach((language) => {
                     generateContentsByDictionary({
                        stream,
                        taskParameters,
                        moduleInfo,
                        dictsIndexer,
                        contentsName: `contents-${language.split('-')[0]}`,
                        language
                     });
                  });
               }

               // generate default contents for backward compatibility
               generateContentsByDictionary({
                  stream,
                  taskParameters,
                  moduleInfo,
                  dictsIndexer,
                  contentsName: 'contents'
               });
            }
         } catch (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: 'Builder error',
               error,
               moduleInfo
            });
         }

         taskParameters.metrics.storePluginTime('presentation service meta - contents.json', startTime);
         callback();
      }
   );
};
