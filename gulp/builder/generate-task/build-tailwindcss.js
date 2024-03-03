/**
 * @author Krylov M.A.
 */

'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');

const logger = require('../../../lib/logger').logger();

const { path } = require('../../../lib/platform/path');
const { getTasksTypesByModules } = require('../../common/compiled-helpers');

const execInPool = require('../../common/exec-in-pool');
const TailwindTreeShaker = require('../../../lib/tailwind/tree-shaker');

const TW_FILE_EXTENSIONS = ['ts', 'tsx', 'wml', 'tmpl'];
const TW_FILE_PATTERN = `**/*.{${TW_FILE_EXTENSIONS.join(',')}}`;

function getCacheDirectory(taskParameters) {
   return path.join(taskParameters.config.cache, 'tailwind-cache');
}

function skipBuildTailwindCss(done) {
   done();
}

function generateTaskForCleanCache(taskParameters) {
   if (taskParameters.config.watcherRunning) {
      // Когда включен watcher, мы используем кеш для сборки Tailwind.
      // Очишать директорию нельзя.
      return function skipCleanTailwindCache(done) {
         return done();
      };
   }

   return async function cleanTailwindCache() {
      try {
         const twCacheDir = getCacheDirectory(taskParameters);

         await fs.promises.rm(twCacheDir, {
            force: true,
            recursive: true
         });

         await fs.promises.mkdir(twCacheDir, {
            recursive: true
         });
      } catch (error) {
         logger.error({
            message: `Error cleaning Tailwind cache directory: ${error.message}`,
            error
         });
      }
   };
}

function generateTaskForScanningTailwind(taskParameters, tailwindModule) {
   const cacheFilePath = path.join(getCacheDirectory(taskParameters), `${tailwindModule.outputName}.json`);

   if (taskParameters.config.watcherRunning) {
      return async function loadTailwindModuleCache() {
         try {
            const cache = await fs.readJson(cacheFilePath);

            tailwindModule.tailwindCssSnapshot = cache.snapshot;
         } catch (error) {
            logger.error({
               message: `Error loading Tailwind/tailwind.css cache: ${error.message}`,
               moduleInfo: tailwindModule,
               error
            });
         }
      };
   }

   return async function scanningTailwindModule() {
      try {
         const filePath = path.join(tailwindModule.path, 'tailwind.css');
         const tailwindCssContents = await fs.readFile(filePath, 'utf8');
         const shaker = new TailwindTreeShaker();

         shaker.shake(tailwindCssContents);

         tailwindModule.tailwindCssSnapshot = shaker.root;

         await fs.writeJSON(cacheFilePath, {
            snapshot: shaker.root
         });
      } catch (error) {
         logger.error({
            message: `Error processing Tailwind/tailwind.css: ${error.message}`,
            moduleInfo: tailwindModule,
            error
         });
      }
   };
}

function generateTaskForBuildSingleModule(taskParameters, tailwindModule, moduleInfo) {
   const cacheFilePath = path.join(getCacheDirectory(taskParameters), `${moduleInfo.outputName}.json`);

   return async function buildCustomTailwind() {
      try {
         const config = {
            tailwindCssSnapshot: tailwindModule.tailwindCssSnapshot,
            tailwindModulePath: tailwindModule.path,
            processingModulePath: moduleInfo.path,
            cachedSnapshot: undefined,
            content: [
               path.join(moduleInfo.path, TW_FILE_PATTERN)
            ]
         };

         if (taskParameters.config.watcherRunning) {
            const cacheData = await fs.readJson(cacheFilePath);
            config.cachedSnapshot = cacheData.snapshot;
            config.content = moduleInfo.changedFiles
               .filter(filePath => TW_FILE_EXTENSIONS.some(ext => filePath.endsWith(`.${ext}`)))
               .map(filePath => path.join(moduleInfo.path, filePath));
         }

         const [error, result] = await execInPool(
            taskParameters.pool,
            'generateTailwind',
            [
               config
            ],
            '',
            moduleInfo
         );

         if (error) {
            logger.error({
               message: `Error building Tailwind CSS: ${error.message}`,
               moduleInfo,
               error
            });

            return;
         }

         taskParameters.metrics.storeWorkerTime('tailwindcss', result.timestamp);

         if (result.text) {
            logger.debug(`Generate custom ${moduleInfo.name}/tailwind.css file with ${result.classSelectors.length} selector(s)`);

            moduleInfo.tailwindInfo = {
               dependency: `css!${moduleInfo.outputName}/tailwind`,
               outputFile: path.join(moduleInfo.path, 'tailwind.css'),
               outputFileContents: result.text,
               selectors: result.classSelectors
            };

            await fs.writeJSON(cacheFilePath, {
               classSelectors: result.classSelectors,
               snapshot: result.root
            });
         }
      } catch (error) {
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
      generateTaskForCleanCache(taskParameters),
      generateTaskForScanningTailwind(taskParameters, tailwindModule),
      gulp.parallel(tasks),
      buildTailwindCss.finish()
   );
}

module.exports = generateTaskForBuildTailwindCss;
