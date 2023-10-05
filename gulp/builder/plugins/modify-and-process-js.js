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
const { componentCantBeParsed } = require('../../../lib/helpers');
const execInPool = require('../../common/exec-in-pool');
const PosixVinyl = require('../../../lib/platform/vinyl');
const helpers = require('../../../lib/helpers');
const transliterate = require('../../../lib/transliterate');
const prepareToSave = require('../../../lib/processing-routes');
const { TS_EXT } = require('../../../lib/builder-constants');
const modifyWithTailwind = require('../../../lib/tailwind/modify');

function updateWithComponentsInfo(moduleInfo, config) {
   const componentsInfo = moduleInfo.cache.getComponentsInfo();

   Object.keys(componentsInfo).forEach((filePath) => {
      const info = componentsInfo[filePath];

      if (info.provided) {
         info.componentDep.forEach((currentDep) => {
            if (config.isFacade(currentDep) && !config.interfaces.provided[info.componentName]) {
               config.interfaces.provided[info.componentName] = currentDep;
            }
         });
      }

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

   const routesInfoText = JSON.stringify(helpers.sortObject(resultRoutesInfo), null, 2);
   const routesInfoFile = new PosixVinyl({
      pPath: 'routes-info.json',
      contents: Buffer.from(routesInfoText),
      moduleInfo
   });

   stream.push(routesInfoFile);
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
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const { interfaces } = taskParameters.config;

   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         const isRoutesFile = file.pPath.endsWith('.routes.js');
         const isMetaFile = file.pHistory[0].endsWith('.meta.ts');
         const isTestFile = file.pPath.endsWith('.test.js') && taskParameters.config.generateUMD;
         const shouldProcess = !file.cached && (
            !componentCantBeParsed(file) || isTestFile || isRoutesFile
         );

         if (!shouldProcess) {
            flushSourceMapFile(this, file, moduleInfo);

            callback(null, file);
            return;
         }

         if (moduleInfo.tailwindInfo) {
            try {
               const mSource = modifyWithTailwind(
                  file.contents.toString(),
                  moduleInfo.tailwindInfo,
                  taskParameters.config.ESVersion
               );

               file.contents = Buffer.from(mSource);
            } catch (error) {
               // FIXME: На время проверки выводим предупреждения. Функционал пока не раскатан, даже демок нет
               logger.warning(`Ошибка tw-обработки файла "${file.pRelative}": ${error}`);
            }
         }

         // for third-party and routes files we should always use ES2021 specs to parse code.
         const isThirdParty = file.pPath.includes('/third-party/');

         // BL handlers are Node.js files, we should always use ES2021 specs to parse code.
         const isBLHandlers = file.pPath.includes('/BLHandlers/');

         // FIXME: Вместо 2021 используем 2019. После завершения проекта, вернуть обратно
         //   https://online.sbis.ru/opendoc.html?guid=275e9e3b-1973-44a9-af21-f922019564fd&client=3
         const ESVersion = isThirdParty || isRoutesFile || isBLHandlers ? 2019 : moduleInfo.ESVersion;
         const relativePath = toSafePosix(path.relative(moduleInfo.appRoot, file.pHistory[0]));
         const sourceFilePath = path.join(moduleInfo.output, path.relative(moduleInfo.path, file.history[0]));

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
                  sourceFilePath,
                  isRoutesFile,
                  isTestFile,
                  sourceMap: file.sourceMapText && JSON.parse(file.sourceMapText),
                  ESVersion
               }
            ],
            file.pHistory[0],
            moduleInfo
         );

         if (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
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
            if (interfaces.providedOrder.includes(componentInfo.componentName)) {
               componentInfo.provided = true;
            }

            if (taskParameters.config.isFacade(componentInfo.componentName)) {
               const outputOriginPath = file.pPath.replace('.js', '.origin.js');

               const interfaceFile = file.clone();
               interfaceFile.compiled = true;
               interfaceFile.pPath = outputOriginPath;
               interfaceFile.pBase = moduleInfo.output;
               taskParameters.cache.addOutputFile(file.pHistory[0], outputOriginPath, moduleInfo);
               this.push(interfaceFile);

               file.baseInterface = true;
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
            updateWithComponentsInfo(moduleInfo, taskParameters.config);

            if (moduleInfo.presentationServiceMeta) {
               saveRoutesInfo(taskParameters, moduleInfo, this);
            }
         } catch (error) {
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
