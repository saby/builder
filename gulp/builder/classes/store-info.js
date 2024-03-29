/**
 * @author Kolbeshin F.A.
 */
'use strict';

const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra'),
   logger = require('../../../lib/logger').logger(),
   { defaultCssVariablesOptions } = require('../../../lib/builder-constants');

const JS_POSSIBLE_SOURCES = ['.js', '.ts', '.tsx'];
const CSS_POSSIBLE_SOURCES = ['.css', '.less'];

/**
 * Class with current build data. For incremental build processing.
 */
class StoreInfo {
   constructor() {
      // в случае изменений параметров запуска проще кеш сбросить,
      // чем потом ошибки на стенде ловить. не сбрасываем только кеш json
      this.runningParameters = {};

      // If hash sum of builder source code was changed we can't use previous builder cache as valid.
      // unknown has further using
      this.hashOfBuilder = 'unknown';

      // время начала предыдущей сборки. нам не нужно хранить дату изменения каждого файла
      // для сравнения с mtime у файлов
      this.startBuildTime = 0;

      // запоминаем что было на входе и что породило на выход, чтобы потом можно было
      // 1. отследить восстановленный из корзины файл
      // 2. удалить лишние файлы
      this.inputPaths = {};

      // information about all minified files that haven't changed since last build.
      this.cachedMinified = {};

      // для инкрементальной сборки нужно знать зависимости файлов:
      // - imports из less файлов
      // - зависимости js на файлы вёрстки для паковки собственных зависмостей
      this.dependencies = {};

      // Чтобы ошибки не терялись при инкрементальной сборке, нужно запоминать файлы с ошибками
      // и подавать их при повторном запуске как изменённые
      this.filesWithErrors = new Set();

      this.themesMeta = {
         cssVariablesOptions: {
            ...defaultCssVariablesOptions,
            variables: {}
         },

         /**
          * Object with all meta info about themes:
          * 1) output theme name(e.g. default, default__cola, default__pink, etc.)
          * 2) list of parts of the theme with theirs relatives paths
          * 3) parameter value whether it should be rebuilt
          */
         themes: {},

         /**
          * Object with info about which theme includes current theme part
          * e.g. theme "default__cola" has a part of it in file Controls-default-theme/cola/theme.less
          */
         themesMap: {},

         // all essential info about fallback.json meta
         // 1) variables map(from which fallback.json it was taken)
         // 2) overall hash sum(it's required to make
         // a decision whether drop cache for all built less files)
         fallbackList: {
            variablesMap: {},
            hashes: {}
         },

         // list of missing themes paths. Needed to remove all these files
         // after compilation to avoid merge conflicts, when developers make their
         // own theme on this path
         missingThemes: {}
      };
   }

   static getLastRunningParametersPath(cacheDirectory) {
      return path.join(cacheDirectory, 'last_build_gulp_config.json');
   }

   async loadInputPaths(cachePath, loadedData) {
      try {
         if (!loadedData) {
            this.inputPaths = await fs.readJson(path.join(cachePath, 'input-paths.json'));
         } else {
            this.inputPaths = loadedData;
         }
      } catch (error) {
         logger.info({
            message: `Cache file "${path.join(cachePath, 'input-paths.json')}" failed to be read`,
            error
         });
      }
   }

   async loadDependencies(cachePath, loadedData) {
      try {
         if (!loadedData) {
            this.dependencies = await fs.readJson(path.join(cachePath, 'dependencies.json'));
         } else {
            this.dependencies = loadedData;
         }
      } catch (error) {
         logger.info({
            message: `Cache file "${path.join(cachePath, 'dependencies.json')}" failed to be read`,
            error
         });
      }
   }

   async loadFilesWithErrors(cachePath, loadedData) {
      try {
         if (!loadedData) {
            const filesWithErrors = await fs.readJson(path.join(cachePath, 'files-with-errors.json'));
            this.filesWithErrors = new Set(filesWithErrors);
         } else {
            this.filesWithErrors = loadedData;
         }
      } catch (error) {
         logger.info({
            message: `Cache file "${path.join(cachePath, 'files-with-errors.json')}" failed to be read`,
            error
         });
      }
   }

   async loadModulesStats(logFolder, loadedData) {
      const modulesStatsPath = path.join(logFolder, 'modules_stats.json');

      try {
         if (!loadedData) {
            if (await fs.pathExists(modulesStatsPath)) {
               this.modulesStats = (await fs.readJson(modulesStatsPath)).modules;
            } else {
               this.modulesStats = {};
            }
         } else {
            this.modulesStats = loadedData;
         }
      } catch (error) {
         this.modulesStats = {};
         logger.info({
            message: `Cache file "${modulesStatsPath}" failed to be read`,
            error
         });
      }
   }

   async load(cachePath) {
      if (await fs.pathExists(path.join(cachePath, 'builder-info.json'))) {
         logger.debug(`Reading builder cache from directory "${cachePath}"`);
         this.runningParameters = await fs.readJSON(StoreInfo.getLastRunningParametersPath(cachePath));

         try {
            const builderInfo = await fs.readJson(path.join(cachePath, 'builder-info.json'));
            this.hashOfBuilder = builderInfo.hashOfBuilder;
            logger.debug(`"hashOfBuilder" in builder cache: ${this.hashOfBuilder}`);
            this.startBuildTime = builderInfo.startBuildTime;
            logger.debug(`"startBuildTime" in builder cache: ${this.startBuildTime}`);
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cachePath, 'builder-info.json')}" failed to be read`,
               error
            });
         }
         await this.loadInputPaths(cachePath);
         await this.loadDependencies(cachePath);
         await this.loadFilesWithErrors(cachePath);
         await this.loadModulesStats(cachePath);
         try {
            this.themesMeta = await fs.readJson(path.join(cachePath, 'themesMeta.json'));
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cachePath, 'themesMeta.json')}" failed to be read`,
               error
            });
         }
         try {
            const cachedMinifiedPath = path.join(cachePath, 'cached-minified.json');
            if (await fs.pathExists(cachedMinifiedPath)) {
               this.cachedMinified = await fs.readJson(cachedMinifiedPath);
            }
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cachePath, 'cached-minified.json')}" failed to be read`,
               error
            });
         }
      }
   }

   async save(cacheDirectory, logFolder) {
      await fs.outputJson(
         path.join(cacheDirectory, 'builder-info.json'),
         {
            hashOfBuilder: this.hashOfBuilder,
            startBuildTime: this.startBuildTime
         },
         {
            spaces: 1
         }
      );
      await fs.outputJson(
         path.join(cacheDirectory, 'input-paths.json'),
         this.inputPaths,
         {
            spaces: 1
         }
      );
      await fs.outputJson(
         path.join(cacheDirectory, 'themesMeta.json'),
         this.themesMeta,
         {
            spaces: 1
         }
      );
      await fs.outputJson(
         path.join(cacheDirectory, 'dependencies.json'),
         this.dependencies,
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         path.join(cacheDirectory, 'files-with-errors.json'),
         [...this.filesWithErrors],
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         StoreInfo.getLastRunningParametersPath(cacheDirectory),
         this.runningParameters,
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         path.join(cacheDirectory, 'cache-path.json'),
         {
            lastCacheDirectory: cacheDirectory,
            lastLogFolder: logFolder
         },
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         path.join(cacheDirectory, 'save-cache-for-less.json'),
         {}
      );

      // save a sign that cache was saved successfully. Needs by builder
      // to make a correct decision whether cache should be removed
      await fs.outputFile(path.join(cacheDirectory, 'cache.lockfile'), '');
   }

   // check if file have collisions in builder cache
   // e.g. migrations of source files - js -> ts, ts -> tsx, css -> less
   // they all have same output file name
   fileHasCollisions(module, currentPath) {
      let result = false;
      const extname = path.extname(currentPath);
      let extensionsToCheck;
      if (JS_POSSIBLE_SOURCES.includes(extname)) {
         extensionsToCheck = JS_POSSIBLE_SOURCES.filter(currentExt => currentExt !== extname);
      } else if (CSS_POSSIBLE_SOURCES.includes(extname)) {
         extensionsToCheck = CSS_POSSIBLE_SOURCES.filter(currentExt => currentExt !== extname);
      } else {
         return false;
      }
      extensionsToCheck.forEach((currentExt) => {
         const normalizedCurrentPath = currentPath.replace(extname, currentExt);
         if (this.inputPaths[module].paths.hasOwnProperty(normalizedCurrentPath)) {
            result = true;
         }
      });
      return result;
   }

   /**
    * get output files list for sources that was transmitted
    * as removed(list of removed files in gulp_config)
    * @param{Object} deletedFiles - a list of removed files
    */
   getOutputFilesSetForDeletedFiles(deletedFiles, isFirstBuild) {
      const resultSet = new Set();

      for (const module in this.inputPaths) {
         if (!this.inputPaths.hasOwnProperty(module)) {
            continue;
         }
         deletedFiles.forEach((currentPath) => {
            if (this.inputPaths[module].paths.hasOwnProperty(currentPath)) {
               const fileHasCollisions = this.fileHasCollisions(module, currentPath);
               if (!fileHasCollisions) {
                  for (const relativeFilePath of this.inputPaths[module].paths[currentPath].output) {
                     const extname = path.extname(relativeFilePath);
                     const curRegex = new RegExp(`(\\.min)?(\\${extname})`);
                     const normalizedRelativePath = relativeFilePath.replace(curRegex, '$2');

                     // if output file of current source file is a source file itself, we cant remove it
                     if (
                        currentPath === normalizedRelativePath ||
                        !this.inputPaths[module].paths.hasOwnProperty(normalizedRelativePath)
                     ) {
                        resultSet.add(relativeFilePath);
                     }
                  }
               } else {
                  resultSet.add(currentPath);
               }
               delete this.inputPaths[module].paths[currentPath];
            }
            if (this.dependencies.hasOwnProperty(currentPath)) {
               delete this.dependencies[currentPath];
            }
         });
      }

      // In case of first build there is no inputPaths, so put all provided files.
      if (isFirstBuild) {
         deletedFiles.forEach(currentPath => resultSet.add(currentPath));
      }
      return resultSet;
   }

   /**
    * Get output files list to get difference between 2 builds and remove trash
    * @param{String} cachePath - physical path to builder cache
    * @param{Array} modulesForPatch - interface modules to be patched
    * @returns {Set<any>}
    */
   getOutputFilesSet(modulesForPatch) {
      const resultSet = new Set();
      for (const module in this.inputPaths) {
         if (!this.inputPaths.hasOwnProperty(module)) {
            continue;
         }
         for (const filePath in this.inputPaths[module].paths) {
            if (!this.inputPaths[module].paths.hasOwnProperty(filePath)) {
               continue;
            }
            for (const relativeFilePath of this.inputPaths[module].paths[filePath].output) {
               // get only paths for patching modules in patch build
               if (modulesForPatch && modulesForPatch.length > 0) {
                  const currentModuleName = relativeFilePath.split('/').shift();
                  if (modulesForPatch.includes(currentModuleName)) {
                     resultSet.add(relativeFilePath);
                  }
               } else {
                  resultSet.add(relativeFilePath);
               }
            }
         }

         // Not sure about other file extensions, add only svg files to remove their packages.
         if (Array.isArray(this.inputPaths[module].output)) {
            this.inputPaths[module].output
               .filter(filePath => filePath.endsWith('.svg'))
               .forEach(svgFilePath => resultSet.add(svgFilePath));
         }
      }
      return resultSet;
   }
}

module.exports = StoreInfo;
