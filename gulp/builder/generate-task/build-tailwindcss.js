/**
 * @author Krylov M.A.
 */

'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');

const logger = require('../../../lib/logger').logger();

const { path } = require('../../../lib/platform/path');
const { getTasksTypesByModules } = require('../../common/compiled-helpers');
const getBuildStatusStorage = require('../../common/classes/build-status');
const getMetricsReporter = require('../../common/classes/metrics-reporter');

const execInPool = require('../../common/exec-in-pool');
const TailwindTreeShaker = require('../../../lib/tailwind/tree-shaker');

const TW_FILE_EXTENSIONS = ['ts', 'tsx', 'wml', 'tmpl'];
const TW_FILE_PATTERN = `**/*.{${TW_FILE_EXTENSIONS.join(',')}}`;

function skipBuildTailwindCss(done) {
   done();
}

function getCacheDirectory(taskParameters) {
   return path.join(taskParameters.config.cache, 'tailwind-cache');
}

function getArtifactPath(taskParameters, moduleInfo) {
   return path.join(getCacheDirectory(taskParameters), `${moduleInfo.outputName}.json`);
}

function getTailwindConfiguration(taskParameters, tailwindModule, moduleInfo, tailwindInfo) {
   const config = {
      tailwindCssSnapshot: tailwindModule.tailwindCssSnapshot,
      tailwindModulePath: tailwindModule.path,
      processingModulePath: moduleInfo.path,
      cachedSnapshot: undefined,
      content: [
         path.join(moduleInfo.path, TW_FILE_PATTERN)
      ]
   };

   if (taskParameters.config.watcherRunning && tailwindInfo) {
      config.cachedSnapshot = tailwindInfo.snapshot;
      config.content = moduleInfo.changedFiles
         .filter(filePath => TW_FILE_EXTENSIONS.some(ext => filePath.endsWith(`.${ext}`)))
         .map(filePath => path.join(moduleInfo.path, filePath));
   }

   return config;
}

function shouldOnlyLoadFromCache(taskParameters, moduleInfo) {
   if (getBuildStatusStorage().cacheIsDropped || moduleInfo.forceRebuild) {
      // В случаях, когда кеш сброшен или запрошена пересборка модуля, кеш не используем
      return false;
   }

   if (Array.isArray(moduleInfo.changedFiles) && Array.isArray(moduleInfo.deletedFiles)) {
      // Если в списке измененных файлов есть файлы с требуемым расширением,
      // то собираем tailwind.css для данного модуля.

      const isTargetFilePredicate = filePath => TW_FILE_EXTENSIONS.some(ext => filePath.endsWith(`.${ext}`));

      return !(
         moduleInfo.changedFiles.some(isTargetFilePredicate) || moduleInfo.deletedFiles.some(isTargetFilePredicate)
      );
   }

   // Если в конфигурацию сборки не переданы измененные файлы,
   // то выполняем сборку css без оптимизаций.
   return false;
}

function generateTaskForInitCache(taskParameters) {
   return function initTailwindCache() {
      const twCacheDir = getCacheDirectory(taskParameters);

      logger.debug(`Init tailwind cache directory in "${twCacheDir}"`);

      return fs.promises.mkdir(twCacheDir, {
         recursive: true
      });
   };
}

function generateTaskForScanningTailwind(taskParameters, tailwindModule) {
   const cacheFilePath = getArtifactPath(taskParameters, tailwindModule);

   return async function scanningTailwindModule() {
      try {
         let tailwindInfo;

         if (await fs.pathExists(cacheFilePath)) {
            tailwindInfo = await fs.readJson(cacheFilePath);

            // Используем кеш, если сборка происходит в watcher или сам модуль Tailwind не содержит изменений.
            if (taskParameters.config.watcherRunning || shouldOnlyLoadFromCache(taskParameters, tailwindModule)) {
               tailwindModule.tailwindCssSnapshot = tailwindInfo.snapshot;

               logger.debug('Use cached snapshot for Tailwind/tailwind.css');

               return;
            }
         }
      } catch (error) {
         getMetricsReporter().markFailedModule(tailwindModule);
         logger.error({
            message: `Error loading cache for Tailwind module: ${error.message}`,
            moduleInfo: tailwindModule,
            error
         });

         return;
      }

      getMetricsReporter().markBuiltModule(tailwindModule);

      try {
         const filePath = path.join(tailwindModule.path, 'tailwind.css');

         const tailwindCssContents = await fs.readFile(filePath, 'utf8');

         const shaker = new TailwindTreeShaker();

         shaker.shake(tailwindCssContents);

         tailwindModule.tailwindCssSnapshot = shaker.root;

         logger.debug('Generate snapshot for tailwind.css');

         await fs.writeJSON(cacheFilePath, {
            snapshot: shaker.root
         });
      } catch (error) {
         getMetricsReporter().markFailedModule(tailwindModule);
         logger.error({
            message: `Error processing Tailwind/tailwind.css: ${error.message}`,
            moduleInfo: tailwindModule,
            error
         });
      }
   };
}

function generateTaskForBuildSingleModule(taskParameters, tailwindModule, moduleInfo) {
   return async function buildCustomTailwind() {
      const cacheFilePath = getArtifactPath(taskParameters, moduleInfo);

      try {
         let tailwindInfo;

         if (await fs.pathExists(cacheFilePath)) {
            tailwindInfo = await fs.readJson(cacheFilePath);

            if (shouldOnlyLoadFromCache(taskParameters, moduleInfo)) {
               moduleInfo.tailwindInfo = tailwindInfo;

               logger.debug(`Use cached Tailwind state for module "${moduleInfo.outputName}"`);

               return;
            }
         }

         await fs.promises.rm(cacheFilePath, {
            force: true
         });

         const configuration = getTailwindConfiguration(taskParameters, tailwindModule, moduleInfo, tailwindInfo);

         getMetricsReporter().markBuiltModule(moduleInfo);

         const [error, result] = await execInPool(
            taskParameters.pool,
            'generateTailwind',
            [
               configuration
            ],
            `${moduleInfo.outputName}/tailwind.css`,
            moduleInfo
         );

         taskParameters.metrics.storeWorkerTime('tailwindcss', result.timestamp);

         if (error) {
            getMetricsReporter().markFailedModule(moduleInfo);
            logger.error({
               message: `Error building Tailwind CSS: ${error.message}`,
               moduleInfo,
               error
            });

            return;
         }

         if (result.text) {
            logger.debug(`Generate custom ${moduleInfo.name}/tailwind.css file with ${result.classSelectors.length} selector(s)`);

            moduleInfo.tailwindInfo = {
               dependency: `css!${moduleInfo.outputName}/tailwind`,
               outputFile: path.join(moduleInfo.path, 'tailwind.css'),
               outputFileContents: result.text,
               selectors: result.classSelectors,
               snapshot: result.root
            };

            moduleInfo.tailwindInfoChanged = true;

            await fs.writeJSON(cacheFilePath, moduleInfo.tailwindInfo);
         }
      } catch (error) {
         getMetricsReporter().markFailedModule(moduleInfo);
         logger.error({
            message: `Error generating ${moduleInfo.outputName}/tailwind.css: ${error.message}`,
            moduleInfo,
            error
         });
      }
   };
}

function generateTaskForBuildTailwindCss(taskParameters) {
   const tailwindModule = taskParameters.config.modules.find(moduleInfo => moduleInfo.name === 'Tailwind');
   if (!tailwindModule) {
      // По какой-то причине модуль Tailwind не был передан в сборку. В таком случае задача не может быть выполнена.
      logger.debug('Tailwind module was not specified in current project');

      return skipBuildTailwindCss;
   }

   const { build } = getTasksTypesByModules(
      taskParameters.config.modules,
      false,
      taskParameters.config.watcherRunning
   );

   const tasks = build
      .filter(moduleInfo => moduleInfo.depends.includes('Tailwind'))
      .map(moduleInfo => generateTaskForBuildSingleModule(taskParameters, tailwindModule, moduleInfo));

   if (tasks.length === 0) {
      return skipBuildTailwindCss;
   }

   const buildTailwindCss = taskParameters.metrics.createTimer('build tailwind');

   return gulp.series(
      buildTailwindCss.start(),
      generateTaskForInitCache(taskParameters),
      generateTaskForScanningTailwind(taskParameters, tailwindModule),
      gulp.parallel(tasks),
      buildTailwindCss.finish()
   );
}

module.exports = generateTaskForBuildTailwindCss;
