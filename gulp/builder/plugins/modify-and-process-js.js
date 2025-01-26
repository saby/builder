/**
 * Плагин для парсинга js компонентов и получения из них всей необходимой для сборки информации.
 * Больше js компоненты парсится не должны нигде.
 * Результат кешируется.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toSafePosix } = require('../../../lib/platform/path');
const through = require('through2');
const logger = require('../../../lib/logger').logger();
const { componentCantBeParsed, moduleHasNoChanges } = require('../../../lib/helpers');
const execInPool = require('../../common/exec-in-pool');
const PosixVinyl = require('../../../lib/platform/vinyl');
const helpers = require('../../../lib/helpers');
const transliterate = require('../../../lib/transliterate');
const prepareToSave = require('../../../lib/processing-routes');
const { TS_EXT } = require('../../../lib/builder-constants');
const modifyWithTailwind = require('../../../lib/tailwind/modify');
const sourceMap = require('../../../lib/source-map');
const getMetricsReporter = require('../../common/classes/metrics-reporter');

function updateWithComponentsInfo(moduleInfo) {
   const componentsInfo = moduleInfo.cache.getComponentsInfo();

   Object.keys(componentsInfo).forEach((filePath) => {
      const info = componentsInfo[filePath];

      if (info.hasOwnProperty('isNavigation') && info.isNavigation) {
         moduleInfo.navigationModules.push(info.componentName);
      }
   });
}

function saveRoutesInfo(taskParameters, moduleInfo, stream) {
   // Всегда сохраняем файл, чтобы не было ошибки при удалении последнего роутинга в модуле.
   // нужно преобразовать абсолютные пути в исходниках в относительные пути в стенде
   const routesInfoBySourceFiles = moduleInfo.cache.getRoutesInfo();
   const resultRoutesInfo = {};
   const { resourcesUrl } = taskParameters.config;

   Object.keys(routesInfoBySourceFiles).forEach((relativePath) => {
      const routeInfo = routesInfoBySourceFiles[relativePath];
      const rebasedRelativePath = resourcesUrl ? path.join('resources', relativePath) : relativePath;
      const relativeResultPath = toSafePosix(transliterate(rebasedRelativePath));
      resultRoutesInfo[relativeResultPath.replace(TS_EXT, '.js')] = routeInfo;
   });

   // подготовим routes-info.json
   prepareToSave(resultRoutesInfo);

   if (Object.keys(resultRoutesInfo).length > 0) {
      const routesInfoText = JSON.stringify(helpers.sortObject(resultRoutesInfo), null, 2);
      const routesInfoFile = new PosixVinyl({
         pPath: 'routes-info.json',
         contents: Buffer.from(routesInfoText),
         moduleInfo
      });

      stream.push(routesInfoFile);
   }
}

function flushSourceMapFile(stream, file, moduleInfo) {
   if (!file.sourceMapText) {
      return;
   }

   const jsMapFile = file.clone();
   jsMapFile.contents = Buffer.from(file.sourceMapText);
   jsMapFile.compiled = true;
   jsMapFile.pPath = file.sourceMapOutput;
   jsMapFile.pBase = moduleInfo.output;

   stream.push(jsMapFile);
}

/**
 * Gets ESVersion for current file
 * @param{ModuleInfo} moduleInfo - all needed information about current interface module
 * @param{PosixVinyl} file - current processing file
 * @param{boolean} isRoutesFile - info about whether current file is routes one
 * @returns {number|*}
 */
function getESVersion(moduleInfo, file, isRoutesFile) {
   // for third-party and routes files we should always use ES2021 specs to parse code.
   const isThirdParty = file.pPath.includes('/third-party/');

   // BL handlers are Node.js files, we should always use ES2021 specs to parse code.
   const isBLHandlers = file.pPath.includes('/BLHandlers/');

   if (isThirdParty || isRoutesFile || isBLHandlers) {
      return 2019;
   }

   // for js sources always use ES5 specification, except unit tests
   if (file.pHistory[0].endsWith('.js')) {
      // use current module transmitted specification for unit tests modules and
      // modules with disabled js parsing(e.g. CDN modules)
      if (moduleInfo.isUnitTestModule || !moduleInfo.parse) {
         return moduleInfo.ESVersion;
      }
      return 5;
   }

   return moduleInfo.ESVersion;
}

function modifyContentsWithTailwind(taskParameters, moduleInfo, contents) {
   const mSource = modifyWithTailwind(
      contents.toString(),
      moduleInfo.tailwindInfo,
      taskParameters.config.ESVersion
   );

   return Buffer.from(mSource);
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         const isMetaFile = file.pHistory[0].endsWith('.meta.ts');
         const isRoutesFile = file.pPath.endsWith('.routes.js');
         const isTestFile = file.pPath.endsWith('.test.js');

         // файлы юнит-тестов должны располагаться только в модулях для юнит-тестирования. Если нашли файл
         // в обычном интерфейсном модуле, ругаемся предупреждением
         if (isTestFile && !moduleInfo.isModuleUnitTest()) {
            logger.warning({
               moduleInfo,
               filePath: file.pHistory[0],
               message: 'Обнаружен файл с описанием тестов в обычном модуле, необходимо перенести его в соответствующий модуль юнит-тестов!'
            });
         }

         const shouldProcess = !file.cached && (
            !componentCantBeParsed(file) || isRoutesFile || isTestFile
         );

         if (!shouldProcess) {
            flushSourceMapFile(this, file, moduleInfo);

            callback(null, file);
            return;
         }

         // не надо парсить js-контент, если в текущем модуле выключен парсинг. Парсинг
         // выключает wasaby-cli в CDN-модулях, где выкладывается уже скомпилированный и
         // готовый к использованию на проде код
         if (moduleInfo.parse === false) {
            callback(null, file);
            return;
         }

         if (moduleInfo.tailwindInfo) {
            try {
               file.contents = modifyContentsWithTailwind(
                  taskParameters,
                  moduleInfo,
                  file.contents
               );

               // Также необходимо при необходимости добавить tailwind зависимость в dev tsx файл
               if (file.developmentContent) {
                  file.developmentContent = modifyContentsWithTailwind(
                     taskParameters,
                     moduleInfo,
                     file.developmentContent
                  );
               }
            } catch (error) {
               // FIXME: На время проверки выводим предупреждения. Функционал пока не раскатан, даже демок нет
               logger.warning(`Ошибка tw-обработки файла "${file.pRelative}": ${error}`);
            }
         }

         // FIXME: Вместо 2021 используем 2019. После завершения проекта, вернуть обратно
         //   https://online.sbis.ru/opendoc.html?guid=275e9e3b-1973-44a9-af21-f922019564fd&client=3
         const ESVersion = getESVersion(moduleInfo, file, isRoutesFile);
         const relativePath = toSafePosix(path.relative(moduleInfo.appRoot, file.pHistory[0]));
         const sourceMapPaths = await sourceMap.createSourceMapPaths(taskParameters, moduleInfo, file);

         const [error, meta] = await execInPool(
            taskParameters.pool,
            'parseJsComponent',
            [
               file.contents.toString(),
               {
                  testsBuild: taskParameters.config.lessCoverage || taskParameters.config.builderTests,
                  generateUMD: taskParameters.config.generateUMD,
                  filePath: path.join(moduleInfo.outputName, file.pRelative),
                  isCompiledFromTsc: file.tscEmit || file.compiled,
                  isRoutesFile,
                  isTestFile,
                  sourceMap: file.sourceMapText && JSON.parse(file.sourceMapText),
                  sourceMapPaths,
                  ESVersion
               }
            ],
            file.pHistory[0],
            moduleInfo
         );

         if (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: 'Ошибка при обработке JS компонента',
               filePath: file.pPath,
               error,
               moduleInfo
            });

            // if current file parse was completed with error, remove file
            // from inputPaths to repeat this error further in next build.
            taskParameters.cache.deleteFailedFromCacheInputs(file.pHistory[0], moduleInfo);

            callback(null);
            return;
         }

         taskParameters.metrics.storeWorkerTime('parseJsComponent', meta.timestamp);

         const {
            componentInfo, routeInfo, umdContent, amdContent
         } = meta;

         if (amdContent) {
            file.contents = Buffer.from(amdContent);
         }

         if (file.developmentContent) {
            file.productionContents = file.contents;
            file.contents = file.developmentContent;
         }

         if (isRoutesFile) {
            moduleInfo.cache.storeRouteInfo(relativePath, routeInfo);
         }

         // .meta.ts файлы на сборке рекваярятся и при изменении зависимого кода могут выскочить
         // ошибки, потому что например могут начать выполнять код, предназначенный для работы
         // исключительно на клиентской стороне. Чтобы не пропускать такие ошибки в rc и ловить
         // их на этапе тестирования по веткам, надо хранить зависимости компилируемых .meta.ts
         // файлов.
         if (isMetaFile && componentInfo.componentDep && componentInfo.componentDep.length > 0) {
            taskParameters.cache.addDependencies(
               moduleInfo.appRoot,
               file.pHistory[0],
               componentInfo.componentDep
            );
         }

         if (umdContent) {
            file.umdContent = umdContent;
            moduleInfo.addUMDModule(file.pRelative);
         }

         if (componentInfo) {
            if (taskParameters.config.isFacade(componentInfo.componentName)) {
               const outputOriginPath = file.pPath.replace('.js', '.origin.js');

               const interfaceFile = file.clone();

               if (umdContent) {
                  moduleInfo.addUMDModule(interfaceFile.pRelative.replace('.js', '.origin.js'));
               }

               interfaceFile.compiled = true;
               interfaceFile.pPath = outputOriginPath;
               interfaceFile.pBase = moduleInfo.output;
               interfaceFile.baseInterface = true;
               taskParameters.cache.addOutputFile(file.pHistory[0], outputOriginPath, moduleInfo);
               this.push(interfaceFile);
            }

            moduleInfo.cache.storeComponentInfo(relativePath, componentInfo);
         }

         /**
          * ts compiled cache is required only in libraries packer, that can be enabled with
          * builder flag "minimize"
          */
         if (taskParameters.config.minimize) {
            moduleInfo.cache.storeCompiledES(relativePath, {
               text: amdContent
            });
         }

         if (meta.umdSourceMap || meta.amdSourceMap) {
            file.sourceMapText = JSON.stringify(meta.umdSourceMap || meta.amdSourceMap);
         }

         flushSourceMapFile(this, file, moduleInfo);
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();

         try {
            if (!moduleHasNoChanges(moduleInfo, [moduleInfo.jsChanged])) {
               updateWithComponentsInfo(moduleInfo);
            }

            if (
               moduleInfo.presentationServiceMeta &&
               !moduleHasNoChanges(moduleInfo, [moduleInfo.routesFilesChanged])
            ) {
               saveRoutesInfo(taskParameters, moduleInfo, this);
            }
         } catch (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }

         taskParameters.metrics.storePluginTime('parseJsComponent', startTime);
         callback();
      }
   );
};
