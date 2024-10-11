/**
 * @author Kolbeshin F.A.
 */

'use strict';

const {
   path,
   toSafePosix,
   toPosix,
   getRelativePath,
   removeLeadingSlashes
} = require('../../../lib/platform/path');
const fs = require('fs-extra'),
   assert = require('assert'),
   pMap = require('p-map');

const helpers = require('../../../lib/helpers'),
   { processChangedFiles } = require('../../../lib/changed-files/cache'),
   { TS_EXT } = require('../../../lib/builder-constants'),
   { FILE_CONTENTS_CACHE, COMMON_CACHE_PROPERTIES } = require('../../../lib/builder-cache-constants'),
   transliterate = require('../../../lib/transliterate'),
   StoreInfo = require('./store-info'),
   logger = require('../../../lib/logger').logger(),
   hooks = require('../../common/classes/hooks').hooks();

const getBuildStatusStorage = require('../../common/classes/build-status');
const getMetricsReporter = require('../../common/classes/metrics-reporter');

/**
 * Regex that checks if a file depends on a markup generator changes
 * @type {RegExp}
 */
const MARKUP_DEPEND_FILES_REGEX = /(\.wml)|(\.tmpl)|(\.ts)|(\.js)$/;

/**
 * Regex that checks if a file saves into builder's cache
 * @type {RegExp}
 */
const CACHED_FILES_EXTENSIONS = /(\.less)|(\.js)|(\.es)|(\.tsx?)|(\.json)$/;

/**
 * Extensions for files that are to be compressed
 * @type {Set<string>}
 */
const COMPRESSED_EXTENSIONS = new Set([
   '.js',
   '.json',
   '.css',
   '.tmpl',
   '.wml',
   '.svg'
]);

// important flags for builder cache
const CACHE_INDEPENDENT_FLAGS = new Set([

   // list of modules shouldn't affect cache invalidation, removed module will be removed from cache
   // new module will be compiled and added to cache
   'modules',

   // changed logs folder can't be a sane reason for a cache removal
   'logs',

   // directory for patch artifacts
   'changedFilesOutput',

   // tsc uses its own cache for incremental build
   'tsc',
   'tscCache',
   'tsconfig',

   // all non-incremental tasks are independent of data from builder cache
   'joinedMeta',
   'customPack',
   'checkModuleDependencies',
   'deprecatedStaticHtml',
   'inlineScripts',
   'compress',
   'staticServer',
   'useReact',
   'hooksPath',
   'hash',
   'selectedModules'
]);

// non-important flags for builder cache. e.g. path can be changed
// and if file hash by content was changed, it'll be rebuilt, then.
const MODULE_CACHE_INDEPENDENT_FLAGS = new Set([
   'path',
   'rebuild',
   'changedFiles',
   'deletedFiles',
   'depends',
   'description',
   'responsible',
   'forceRebuild',
   'hash',
   'kaizen',
   'compiled',
   'required',
   'service'
]);

// filter object by current filter function
function filterObject(object, filter) {
   const result = {};
   Object.keys(object).forEach((currentKey) => {
      if (filter(currentKey)) {
         result[currentKey] = object[currentKey];
      }
   });
   return result;
}

/**
 * check common list of flags that affects builder cache generating
 * @param {Object} lastRunningParameters - previous build running parameters
 * @param {Object} currentRunningParameters - current build running parameters
 * @returns {boolean} true if flags were changed between 2 builds
 */
function checkCommonFlags(lastRunningParameters, currentRunningParameters) {
   const isFlagDependent = flag => !CACHE_INDEPENDENT_FLAGS.has(flag);
   const currentCacheFlags = helpers.sortObject(filterObject(currentRunningParameters, isFlagDependent));
   const lastCacheFlags = helpers.sortObject(filterObject(lastRunningParameters, isFlagDependent));

   try {
      assert.deepStrictEqual(currentCacheFlags, lastCacheFlags);
   } catch (error) {
      return error;
   }
   return false;
}

function checkForFileInLastStore(currentStore, lastStore, relativePath) {
   /**
    * each of these cache types has its own files and don't intersect with each other,
    * so we can surely migrate file for last store to current store only for first cache match
    * and ignore each other one.
    */
   FILE_CONTENTS_CACHE.some((currentCache) => {
      if (lastStore[currentCache].hasOwnProperty(relativePath)) {
         currentStore[currentCache][relativePath] = lastStore[currentCache][relativePath];
         return true;
      }
      return false;
   });

   /**
    * for common cache properties there could be intersects for file in each of cache types,
    * so we need too check for existence of current file in each of these cache properties
    */
   COMMON_CACHE_PROPERTIES.forEach((currentCache) => {
      if (lastStore[currentCache].hasOwnProperty(relativePath)) {
         currentStore[currentCache][relativePath] = lastStore[currentCache][relativePath];
      }
   });
}

/**
 * Migrates cache by property name
 * @param {StoreInfo} lastCache - builder cache from previous build
 * @param {StoreInfo} currentCache - builder cache from currentBuild build
 * @param {String} propertyName - property name to be migrated
 */
function migrateByPropertyName(lastCache, currentCache, propertyName) {
   if (lastCache) {
      Object.keys(lastCache).forEach((currentKey) => {
         if (propertyName && currentCache[currentKey]) {
            const lastModuleCache = lastCache[currentKey][propertyName];
            const currentModuleCache = currentCache[currentKey][propertyName];
            Object.keys(lastModuleCache)
               .forEach((currentPath) => {
                  if (!currentModuleCache[currentPath]) {
                     currentModuleCache[currentPath] = lastModuleCache[currentPath];
                  }
               });
         } else if (!currentCache[currentKey]) {
            currentCache[currentKey] = lastCache[currentKey];
         }
      });
   }
}

function splitRelativePath(relativePath) {
   const moduleName = relativePath.split('/').shift();
   const relPath = `./${path.relative(moduleName, relativePath)}`;

   return [moduleName, relPath];
}

// check if current file was failed to build in a previous build
function isFileFailed(moduleInfo, relativePath) {
   const [, relPath] = splitRelativePath(relativePath);
   const filesWithErrors = moduleInfo.cache.getFailedFiles();

   return filesWithErrors.includes(relPath);
}

/**
 * Класс кеша для реализации инкрементальной сборки.
 * Использует результаты работы предыдущей сборки, чтобы не делать повторную работу.
 */
class Cache {
   constructor(config) {
      this.config = config;
      this.lastStore = new StoreInfo();
      this.currentStore = new StoreInfo();
      this.dropCacheForMarkup = false;
      this.dropCacheForStaticMarkup = false;
      this.dropCacheForLess = false;
      this.previousRunFailed = false;

      // js и less файлы инвалидируются с зависимостями
      // less - зависмости через import
      // js - зависимости на xhtml и tmpl для кастомной паковки
      this.cacheChanges = {};

      // сохраняем в кеше moduleDependencies для быстрого доступа в паковке, чтобы не читать файлы
      this.moduleDependencies = {
         links: {},
         nodes: {},
         packedLibraries: {},
         lessDependencies: {}
      };

      // store of compiled resources. It is the storage to be used
      // if there are compiled sources selected to be used in current
      // build.
      this.compiledStore = {
         dependencies: { },
         inputPaths: { }
      };

      // This data is required for html.tmpl compilation when router/builder resolves dependency paths.
      this.commonBundlesRoute = null;
   }

   // setting default store values for current interface module
   setDefaultStore(moduleInfo) {
      this.currentStore.inputPaths[moduleInfo.outputName] = {
         hash: '',
         output: [],
         paths: {},
         externalDependencies: {}
      };

      // create empty cache in last store to avoid errors when builder
      // tries to get cache of some new module paths from cache where it's
      // not existing yet
      if (!this.lastStore.inputPaths.hasOwnProperty(moduleInfo.outputName)) {
         this.lastStore.inputPaths[moduleInfo.outputName] = {
            hash: '',
            output: [],
            paths: {},
            externalDependencies: {}
         };
      }
   }

   // loads essential cache of compiled sources
   async loadCompiled(modules) {
      this.compiledStore.inputPaths = {};
      this.compiledStore.dependencies = {};

      await pMap(
         modules,
         async(moduleInfo) => {
            const inputPathsCachePath = path.join(this.config.compiled, moduleInfo.outputName, '.cache/input-paths.json');
            const dependenciesCachePath = path.join(this.config.compiled, moduleInfo.outputName, '.cache/dependencies.json');

            if (await fs.pathExists(inputPathsCachePath)) {
               this.compiledStore.inputPaths[moduleInfo.outputName] = await fs.readJson(inputPathsCachePath);
            }

            if (await fs.pathExists(dependenciesCachePath)) {
               const currentDependenciesCache = await fs.readJson(dependenciesCachePath);

               Object.keys(currentDependenciesCache).forEach((currentDependency) => {
                  this.compiledStore.dependencies[currentDependency] = currentDependenciesCache[currentDependency];
               });
            }
         },
         { concurrency: 50 }
      );
   }

   // checks whether first or not is current build
   isFirstBuild() {
      return this.lastStore.startBuildTime === 0;
   }

   isCacheNeeded() {
      if (!this.hasOwnProperty('loadCache')) {
         this.loadCache = !this.isFirstBuild() && !this.hasIncompatibleChanges;
      }
      return this.loadCache;
   }

   // moves old cache if it's interface module isn't participating in
   // current patch build
   migrateMissingCache(cacheName) {
      if (this.lastStore[cacheName]) {
         if (cacheName === 'inputPaths') {
            migrateByPropertyName(this.lastStore[cacheName], this.currentStore[cacheName], 'paths');
            migrateByPropertyName(this.lastStore[cacheName], this.currentStore[cacheName], 'output');
         } else {
            migrateByPropertyName(this.lastStore[cacheName], this.currentStore[cacheName]);
         }
      }
   }

   // Проверяет код шаблонизатора на изменения с момента предыдущей сборки
   // Это нужно чтобы при загрузке кеша мы уже знали, что нам необходимо сбросить
   // кеш шаблонов ещё перед тем, как мы начали вычитывать и компилировать ts-код
   checkTemplatesProcessorChanges() {
      if (this.lastStore.templatesProcessorHash) {
         const lastHashes = this.lastStore.templatesProcessorHash;
         const currentHashes = this.currentStore.templatesProcessorHash;
         if (lastHashes.Compiler && lastHashes.Compiler !== currentHashes.Compiler) {
            this.dropCacheForMarkup = true;
         }
         if (lastHashes.UI && lastHashes.UI !== currentHashes.UI) {
            this.dropCacheForStaticMarkup = true;
         }
         if (lastHashes.View && lastHashes.View !== currentHashes.View) {
            this.dropCacheForOldMarkup = true;
         }
      }
   }

   storeTemplatesProcessorHash() {
      this.currentStore.templatesProcessorHash = this.config.templatesProcessorHash;
   }

   async load(changedFilesWithDependencies) {
      await this.lastStore.load(this.config.cachePath, this.config.modules, this.config.watcherRunning);

      // запишем в текущее хранилище кеш шаблонизатора, он нам последуется для сохранения в кеше текущей сборки
      // и при сравнении в текущей сборке с последним сохранённым значением в кеше.
      this.storeTemplatesProcessorHash();
      this.checkTemplatesProcessorChanges();

      // нам нужно залогировать сброс кеша шаблонов при изменении файлов шаблонизатора при использовании механизма
      // changedFiles
      if (this.config.dropCacheForMarkupPath) {
         await this.checkForDropCacheCases(
            `temp-modules/${this.config.dropCacheForMarkupPath}`,
            this.config.dropCacheForMarkupPath
         );
      }

      if (this.config.dropCacheForOldMarkupPath) {
         await this.checkForDropCacheCases(
            `temp-modules/${this.config.dropCacheForOldMarkupPath}`,
            this.config.dropCacheForOldMarkupPath
         );
      }

      if (this.config.dropCacheForStaticMarkupPath) {
         await this.checkForDropCacheCases(
            `temp-modules/${this.config.dropCacheForStaticMarkupPath}`,
            this.config.dropCacheForStaticMarkupPath
         );
      }

      if (this.config.dropCacheForMetatypes) {
         const reason = `Изменился компонент генератора метатипов "${this.config.dropCacheForMetatypes}". Все метатипы будут пересобраны`;
         logger.info(reason);
         this.dropCacheForMetatypes = true;
         getMetricsReporter().onCacheDrop('metatypes', reason);
         await hooks.executeHook('dropCacheHook', ['metatypes', reason]);
      }

      this.currentStore.runningParameters = this.config.rawConfig;

      // read current builder hash from root of builder.
      this.currentStore.hashOfBuilder = await fs.readFile(path.join(__dirname, '../../../builderHashFile'), 'utf8');
      this.currentStore.startBuildTime = new Date().getTime();

      this.config.modules.forEach((moduleInfo) => {
         this.setDefaultStore(moduleInfo);

         // если при прошлой работе компилятора tsc были найдены ошибки и были изменения в данный интерфейсный модуль
         // добавить их также в текущую сборку чтобы пересобрать данные файлы.
         if (this.lastStore.tscFilesWithErrors && this.lastStore.tscFilesWithErrors[moduleInfo.name]) {
            // если в рамках сборки changedFiles не передан, модуль будет прочитан целиком и все изменившиеся
            // файлы сами будут пересобраны.
            if (moduleInfo.changedFiles) {
               this.lastStore.tscFilesWithErrors[moduleInfo.name].forEach((currentFile) => {
                  if (!moduleInfo.changedFiles.includes(currentFile)) {
                     moduleInfo.changedFiles.push(currentFile);
                  }
               });
            }
         }
      });

      if (this.markupCacheIsDropped()) {
         Object.keys(this.lastStore.dependencies).forEach((currentDependency) => {
            const currentDependencies = this.lastStore.dependencies[currentDependency];
            if (currentDependencies) {
               const hasTemplate = currentDependencies.some(dependency => dependency.endsWith('.wml') || dependency.endsWith('.tmpl'));

               if (hasTemplate) {
                  const dependencyModuleName = currentDependency.split('/').shift();
                  const currentModuleInfo = this.config.getModuleInfoByName(dependencyModuleName);
                  currentModuleInfo.checkForCommonExtensions(currentDependency, 'change');

                  if (!changedFilesWithDependencies[dependencyModuleName]) {
                     changedFilesWithDependencies[dependencyModuleName] = [];
                  }

                  changedFilesWithDependencies[dependencyModuleName].push(currentDependency);
               }
            }
         });
      }

      // if changed file is someone's dependency, we need to add one too into changed files list
      // to rebuild it
      Object.keys(changedFilesWithDependencies).forEach((currentModule) => {
         changedFilesWithDependencies[currentModule].forEach((currentChangedFile) => {
            Object.keys(this.lastStore.dependencies).forEach((currentDependency) => {
               if (
                  this.lastStore.dependencies[currentDependency] &&
                  this.lastStore.dependencies[currentDependency].includes(currentChangedFile)
               ) {
                  const dependencyModuleName = currentDependency.split('/').shift();
                  const currentModuleInfo = this.config.getModuleInfoByName(dependencyModuleName);
                  currentModuleInfo.checkForCommonExtensions(currentDependency, 'change');

                  if (!changedFilesWithDependencies[dependencyModuleName]) {
                     changedFilesWithDependencies[dependencyModuleName] = [];
                  }
                  changedFilesWithDependencies[dependencyModuleName].push(currentDependency);
               }
            });
         });
      });
   }

   save(migrateCache) {
      // TODO: Миграция кеша необходима, когда на одном кеше собираются несколько проектов
      //    (Так сейчас происходит в сборках по веткам). В итоге получаем, что в конечной директории
      //    содержится исходных файлов порой с избытком. Подумать о лучшей организации кеша в задаче:
      //    https://online.sbis.ru/opendoc.html?guid=948e03fc-c2af-4e22-ba70-d662cd5f7d84&client=3
      if (!this.config.clearOutput || migrateCache) {
         this.migrateMissingCache('inputPaths');
         this.migrateMissingCache('dependencies');
      }

      return this.currentStore.save(this.config.cachePath, this.config.logFolder, this.config.modules);
   }

   // checks if there is output directory for each interface module
   // If not, set forceRebuild status for this module
   async checkOutputModulesDirectories() {
      const finishText = 'Данный модуль будет собран с нуля.';

      await pMap(
         this.config.modules,
         async(moduleInfo) => {
            let moduleDescriptionPath = path.join(moduleInfo.output, `${moduleInfo.outputName}.s3mod`);
            let isOutputExists = await fs.pathExists(moduleDescriptionPath);
            if (!isOutputExists) {
               const reason = `Описание "${moduleDescriptionPath}" для модуля "${moduleInfo.name}" было удалено. ${finishText}`;
               logger.info(reason);
               getMetricsReporter().onCacheDrop('module', reason);
               await hooks.executeHook('dropCacheHook', ['module', reason]);
               moduleInfo.forceRebuild = true;
            }
            if (!this.config.outputIsCache) {
               moduleDescriptionPath = path.join(this.config.rawConfig.output, moduleInfo.outputName, `${moduleInfo.outputName}.s3mod`);
               isOutputExists = await fs.pathExists(moduleDescriptionPath);
               if (!isOutputExists) {
                  const reason = `Описание "${moduleInfo.outputName}/${moduleInfo.outputName}.s3mod" для модуля "${moduleInfo.name}" было удалено. ${finishText}`;
                  logger.info(reason);
                  getMetricsReporter().onCacheDrop('module', reason);
                  await hooks.executeHook('dropCacheHook', ['module', reason]);
                  moduleInfo.forceRebuild = true;
               }
            }
         }
      );
   }

   checkForForceModuleRebuild() {
      const lastRunningParameters = { ...this.lastStore.runningParameters };
      const currentRunningParameters = { ...this.currentStore.runningParameters };

      if (!Array.isArray(lastRunningParameters.modules) || !Array.isArray(currentRunningParameters.modules)) {
         return;
      }

      const isDependentModuleFlag = flag => !MODULE_CACHE_INDEPENDENT_FLAGS.has(flag);
      const lastModulesIndexes = { };

      // checks each interface module between 2 builds to have equal common flags
      // that have any influence for builder cache
      lastRunningParameters.modules.forEach((currentModule, index) => {
         lastModulesIndexes[currentModule.name] = index;

         return currentModule.name;
      });

      currentRunningParameters.modules.forEach((currentModule) => {
         const lastModule = lastRunningParameters.modules[lastModulesIndexes[currentModule.name]];

         if (lastModule) {
            const lastModuleConfig = filterObject(lastModule, isDependentModuleFlag);
            const currentModuleConfig = filterObject(currentModule, isDependentModuleFlag);

            try {
               assert.deepStrictEqual(lastModuleConfig, currentModuleConfig);
            } catch (error) {
               currentModule.forceRebuild = true;
            }
         }
      });
   }

   /**
    * Проверяет есть ли несовместимые изменения в проекте, из-за которых нужно очистить кеш.
    * @returns {Promise<boolean>}
    */
   async cacheHasIncompatibleChanges(logsToSave) {
      // do no check of gulp_config if it's disabled manually
      if (!this.config.checkConfig) {
         return false;
      }

      // builder was asked for full rebuild all modules
      // we must remove cache and output
      if (this.config.forceRebuild) {
         const reason = 'В билдер был передан флаг forceRebuild';
         getMetricsReporter().onCacheDrop('all', reason);
         await hooks.executeHook('dropCacheHook', ['all', reason]);
         return true;
      }

      const finishText = 'Кеш и результат предыдущей сборки будут удалены.';
      if (this.previousRunFailed) {
         const reason = 'В кеше найден builder.lockfile.';
         getMetricsReporter().onCacheDrop('all', reason);
         await hooks.executeHook('dropCacheHook', ['all', reason]);
         logsToSave.push(`${reason} ${finishText}`);
         return true;
      }
      if (this.lastStore.hashOfBuilder === 'unknown') {
         const reason = 'Кеша сборки ещё не существует.';
         getMetricsReporter().onCacheDrop('all', reason);
         await hooks.executeHook('dropCacheHook', ['all', reason]);
         logsToSave.push(`${reason}`);
         return true;
      }

      if (this.lastStore.runningParameters.criticalErrors) {
         const reason = 'Предыдущая сборка была завершена с критическими ошибками';
         getMetricsReporter().onCacheDrop('all', reason);
         await hooks.executeHook('dropCacheHook', ['all', reason]);
         logsToSave.push(`${reason} ${finishText}`);
         return true;
      }

      // check hash of builder code for changes. If changed, rebuild the whole project.
      // In new version builder code can be changed too often, ergo causes cache removal in all
      // of branch tests(controls, engine, ui, etc.) that sometimes is needless due to kind of
      // changes in builder and nonetheless causes build time decrease as often as we aren't expected.
      // Thus, for now don't use this feature in branch tests until there is a better solution to choose
      // whether or not builder cache should be removed due to builder code base changes.
      const isNewBuilder = this.lastStore.hashOfBuilder !== this.currentStore.hashOfBuilder;
      if (isNewBuilder) {
         const reason = 'Код билдера и его хеш сумма изменились с последней сборки.';
         getMetricsReporter().onCacheDrop('all', reason);
         await hooks.executeHook('dropCacheHook', ['all', reason]);
         logsToSave.push(`${reason} ${finishText}`);
         return true;
      }

      const lastRunningParameters = { ...this.lastStore.runningParameters };
      const currentRunningParameters = { ...this.currentStore.runningParameters };

      // version parameter is always different between 2 builds, so we can remove cache only
      // if parameter was removed or added since last build
      if (lastRunningParameters.version !== '' || currentRunningParameters.version !== '') {
         if (lastRunningParameters.version === '' || currentRunningParameters.version === '') {
            const versionParamStatus = lastRunningParameters.version === '' ? 'enabled' : 'disabled';
            const reason = `Version parameter has been ${versionParamStatus}.`;
            getMetricsReporter().onCacheDrop('all', reason);
            await hooks.executeHook('dropCacheHook', ['all', reason]);
            logsToSave.push(`${reason} ${finishText}`);
            return true;
         }
         lastRunningParameters.version = '';
         currentRunningParameters.version = '';
      }

      await this.checkOutputModulesDirectories();

      // if output directory was somehow removed, cache should be reset
      if (!await fs.pathExists(this.config.output)) {
         const reason = `Конечной папки ${this.config.output} не найдено.`;
         getMetricsReporter().onCacheDrop('all', reason);
         await hooks.executeHook('dropCacheHook', ['all', reason]);
         logsToSave.push(` ${finishText}`);
         return true;
      }

      // check is there difference between common builder flags that have their influence on a whole project build.
      const isCommonFlagsChanged = checkCommonFlags(lastRunningParameters, currentRunningParameters);
      if (isCommonFlagsChanged) {
         const reason = 'Изменился общий список флагов.';
         getMetricsReporter().onCacheDrop('all', reason);
         await hooks.executeHook('dropCacheHook', ['all', reason]);
         logger.info(`${reason} ${finishText}`);
         logger.info(isCommonFlagsChanged);
         logsToSave.push(`${reason} ${finishText}`);
         return true;
      }

      return false;
   }

   // Clear cache if incremental build is unavailable
   async clearCacheIfNeeded() {
      const removePromises = [];
      const logsToSave = [];
      const cacheHasIncompatibleChanges = await this.cacheHasIncompatibleChanges(logsToSave);

      if (cacheHasIncompatibleChanges) {
         getBuildStatusStorage().cacheIsDropped = true;
         this.lastStore = new StoreInfo();
         this.hasIncompatibleChanges = true;

         // we can remove all cache content, except meta created before cache checking:
         // 1)builder.lockfile - protection file for single build of current project.
         // 2)temp-modules - directory of all sources modules symlinks of current project
         // 3)typescript-cache - directory with tsc compiler cache and emit
         if (await fs.pathExists(this.config.cachePath)) {
            for (const fileName of await fs.readdir(this.config.cachePath)) {
               if (!(fileName.endsWith('.lockfile') || ['temp-modules', 'typescript-cache', 'lock-files', 'builder-extra-config.json', 'tailwind-cache'].includes(fileName))) {
                  const currentPath = path.join(this.config.cachePath, fileName);
                  removePromises.push(fs.remove(currentPath));
                  this.config.addIntoGarbage(currentPath);
               }
            }
         }

         if (!this.config.isSourcesOutput) {
            if (await fs.pathExists(this.config.outputPath)) {
               removePromises.push(fs.remove(this.config.outputPath));
               this.config.addIntoGarbage(this.config.outputPath);
            }

            if (await fs.pathExists(this.config.rawConfig.output)) {
               removePromises.push(fs.remove(this.config.rawConfig.output));
               this.config.addIntoGarbage(this.config.rawConfig.output);
            }
         }
      } else {
         // не надо проверять помодульный кеш, если уже был глобальный сброс кеша. На маке есть проблема с гонками при
         // удалении файлов и в юнитах билдера нестабильно раз в месяц стреляет ошибка EINVAL: invalid argument, rmdir
         // https://github.com/sindresorhus/del/issues/68
         this.checkForForceModuleRebuild();

         await pMap(
            this.config.modules,
            async(moduleInfo) => {
               // when module compiled parameter is selected as false, we need to check if its module
               // symlink exists in output directory to avoid situation when gulp.dest overrides
               // compiled module original files. Remove symlink if exists.
               if (typeof moduleInfo.compiled === 'boolean' && !moduleInfo.compiled) {
                  const moduleOutput = path.join(this.config.outputPath, moduleInfo.outputName);

                  if (await fs.pathExists(moduleOutput)) {
                     const stats = await fs.lstat(moduleOutput);

                     if (stats.isSymbolicLink()) {
                        await fs.unlink(moduleOutput);
                        logger.debug(`Symlink for compiled module ${moduleInfo.outputName} was erased`);

                        // in that case we should force rebuild this module because output was erased
                        moduleInfo.forceRebuild = true;
                     }
                  }
               }

               // builder was asked for full rebuild particular module.
               // we must remove its cache and output
               if (!moduleInfo.forceRebuild) {
                  return;
               }

               const cacheDirPath = path.join(this.config.cachePath, moduleInfo.outputName);
               const outputDirPath = path.join(this.config.outputPath, moduleInfo.outputName);

               if (await fs.pathExists(cacheDirPath)) {
                  removePromises.push(fs.remove(cacheDirPath));
                  this.config.addIntoGarbage(cacheDirPath);
               }

               if (await fs.pathExists(outputDirPath) && (cacheDirPath !== outputDirPath)) {
                  removePromises.push(fs.remove(outputDirPath));
                  this.config.addIntoGarbage(outputDirPath);
               }

               // Clean cache for rebuilding module
               if (this.lastStore.inputPaths.hasOwnProperty(moduleInfo.outputName)) {
                  delete this.lastStore.inputPaths[moduleInfo.outputName];
                  this.setDefaultStore(moduleInfo);
               }

               Object.keys(this.lastStore.dependencies)
                  .filter(currentDep => currentDep.startsWith(`${moduleInfo.outputName}/`))
                  .forEach(
                     currentDependency => delete this.lastStore.dependencies[currentDependency]
                  );

               logsToSave.push(`Force rebuild module ${moduleInfo.name}, its cache and output were removed`);
            }
         );
      }

      // save logs of cache check results
      const currentBuildLogsPath = path.join(
         this.config.logs,
         `${this.config.startBuildTime}`,
         'current-build-cache-check-result.log'
      );
      if (removePromises.length === 0) {
         logsToSave.forEach(currentLog => logger.info(currentLog));
         await fs.outputFile(currentBuildLogsPath, logsToSave.join('\n'));
         return;
      }
      logsToSave.push('Running cache clean');
      logsToSave.push(`Removing directories: ${this.config.getGarbageList()}`);
      logsToSave.forEach(currentLog => logger.info(currentLog));

      await Promise.all(removePromises);

      logsToSave.push('Cache clean was completed successfully!');
      logger.info('Cache clean was completed successfully!');

      await fs.outputFile(currentBuildLogsPath, logsToSave.join('\n'));
   }

   /**
    * if View/Builder components were changed, we need to rebuild all templates in project
    * with current templates processor changes. Also check UI components for changing between
    * 2 builds, it's using by static VDOM pages compiler.
    * Use similar check for metatypes.
    */
   async checkForDropCacheCases(prettyPath, prettyRelativePath) {
      if (!getBuildStatusStorage().cacheIsDropped) {
         const generateReason = (component, cacheType) => {
            if (this.config.watcherRunning) {
               return `Изменился компонент ${component} шаблонизатора. Кеш ${cacheType} шаблонов не будет сброшен. Для применения изменений запустите сборку в полном режиме. Изменившийся файл: ${prettyRelativePath}`;
            }

            return `Изменился компонент ${component} шаблонизатора. Кеш ${cacheType} шаблонов будет сброшен. Изменившийся файл: ${prettyRelativePath}`;
         };

         if (!this.dropCacheForStaticMarkup && prettyPath.includes('temp-modules/UI/')) {
            const reason = generateReason('html.tmpl', 'html.tmpl');
            logger.info(reason);
            this.dropCacheForStaticMarkup = true;
            getMetricsReporter().onCacheDrop('html.tmpl', reason);
            await hooks.executeHook('dropCacheHook', ['html.tmpl', reason]);
         }

         if (!this.dropCacheForMarkup && prettyPath.includes('temp-modules/Compiler/')) {
            const reason = generateReason('wml', 'wml/tmpl');
            logger.info(reason);
            this.dropCacheForMarkup = true;
            getMetricsReporter().onCacheDrop('wml/tmpl', reason);
            await hooks.executeHook('dropCacheHook', ['wml/tmpl', reason]);
         }

         if (!this.dropCacheForOldMarkup && prettyPath.includes('temp-modules/View/Compiler')) {
            const reason = generateReason('xhtml', 'xhtml');
            logger.info(reason);
            this.dropCacheForOldMarkup = true;
            getMetricsReporter().onCacheDrop('xhtml', reason);
            await hooks.executeHook('dropCacheHook', ['xhtml', reason]);
         }

         if (!this.dropCacheForMetatypes && prettyPath.includes('temp-modules/Meta/')) {
            const reason = `Изменился компонент генератора метатипов. Кеш метатипов будет сброшен. Изменившийся файл: ${prettyRelativePath}`;
            logger.info(reason);
            this.dropCacheForMetatypes = true;
            getMetricsReporter().onCacheDrop('metatypes', reason);
            await hooks.executeHook('dropCacheHook', ['metatypes', reason]);
         }
      }
   }

   setDefaultInputFileMeta(store, moduleInfo, hash, prettyRelativePath, outputRelativePath) {
      this[store].inputPaths[moduleInfo.outputName].paths[prettyRelativePath] = {
         hash,
         output: [toPosix(outputRelativePath)]
      };
   }

   /**
    * Проверяет нужно ли заново обрабатывать файл или можно ничего не делать.
    * @param {string} filePath путь до файла
    * @param {Buffer} fileContents содержимое файла
    * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow.
    * @returns {Promise<boolean>}
    */
   async isFileChanged(filePath, fileContents, hashByContent, fileTimeStamp, moduleInfo) {
      const prettyPath = toPosix(filePath);
      const prettyRelativePath = getRelativePath(moduleInfo.appRoot, prettyPath);
      const hash = helpers.calcHash(fileContents, 'base64');

      const isChanged = !moduleInfo.fileHashCheck || await this._isFileChanged(
         moduleInfo,
         hashByContent,
         prettyRelativePath,
         prettyPath,
         hash
      );

      // when changedFiles used, check changed files to be a compiler source
      // and drop templates cache.
      if (moduleInfo.changedFiles) {
         await this.checkForDropCacheCases(prettyPath, prettyRelativePath);
      }

      if (!this.currentStore.inputPaths[moduleInfo.outputName].paths.hasOwnProperty(prettyRelativePath)) {
         const relativePath = path.relative(moduleInfo.path, filePath);
         const outputRelativePath = path.join(path.basename(moduleInfo.output), transliterate(relativePath));
         this.setDefaultInputFileMeta('currentStore', moduleInfo, hash, prettyRelativePath, outputRelativePath);
      }

      if (!isChanged) {
         // вытащим данные из старого кеша в новый кеш
         const lastModuleCache = moduleInfo.cache.lastStore;
         const currentModuleCache = moduleInfo.cache.currentStore;
         checkForFileInLastStore(currentModuleCache, lastModuleCache, prettyRelativePath);

         if (this.lastStore.dependencies.hasOwnProperty(prettyRelativePath)) {
            this.currentStore.dependencies[prettyRelativePath] = this.lastStore.dependencies[prettyRelativePath];
         }
      }

      return isChanged;
   }

   async _isFileChanged(moduleInfo, hashByContent, prettyRelativePath, prettyPath, hash) {
      // кеша не было, значит все файлы новые
      if (!this.lastStore.startBuildTime) {
         return true;
      }

      // if templates cache was dropped off, we need also to rebuild ts files because of pack own dependencies task
      // needs a compiled js file(from ts source) to pack actual compiled template into it. That behaviour could be
      // established only with force cache reset for ts files. For js files cache checker will detect a change of
      // dependent wml files, so there is no need of force reset of cache for those.
      if (this.dropCacheForMarkup && MARKUP_DEPEND_FILES_REGEX.test(prettyPath)) {
         return true;
      }
      if (this.dropCacheForOldMarkup && prettyPath.endsWith('.xhtml')) {
         return true;
      }
      if (this.dropCacheForStaticMarkup && prettyPath.endsWith('.html.tmpl')) {
         return true;
      }

      // если список тем поменялся, то нужно все less пересобрать
      if (this.dropCacheForLess && (prettyPath.endsWith('.less'))) {
         return true;
      }

      const { outputName, appRoot } = moduleInfo;

      // новый файл
      if (!this.lastStore.inputPaths[outputName].paths.hasOwnProperty(prettyRelativePath)) {
         return true;
      }

      // файл с ошибкой
      if (isFileFailed(moduleInfo, prettyRelativePath)) {
         return true;
      }

      if (this.lastStore.inputPaths[outputName].paths[prettyRelativePath].hash !== hash) {
         await this.checkForDropCacheCases(prettyPath, prettyRelativePath);
         if (CACHED_FILES_EXTENSIONS.test(prettyPath)) {
            this.cacheChanges[prettyPath] = true;
         }
         return true;
      }

      // если локализуемые стили задаются через less,
      // то при инкрементальной сборке в lang/en-US/en-US.js не попадает информация о стилях.
      // TODO: Организовать кеширование локализуемых less файлов по задаче:
      // https://online.sbis.ru/opendoc.html?guid=7f4d01c5-32f0-4e80-8e7e-4e891e21c830
      if (path.basename(prettyPath) === 'en-US.less') {
         return true;
      }

      if (CACHED_FILES_EXTENSIONS.test(prettyRelativePath)) {
         const isChanged = await this._isDependenciesChanged(hashByContent, prettyRelativePath, appRoot);
         this.cacheChanges[prettyRelativePath] = isChanged;
         return isChanged;
      }

      return false;
   }

   addMissingTheme(theme, themeContent) {
      this.currentStore.themesMeta.missingThemes[theme] = themeContent;
   }

   addRegionNode(moduleName, currentCssNode, region, key, value) {
      if (!this.currentStore.regionNodes[moduleName]) {
         this.currentStore.regionNodes[moduleName] = {};
      }

      if (!this.currentStore.regionNodes[moduleName][currentCssNode]) {
         this.currentStore.regionNodes[moduleName][currentCssNode] = {};
      }

      if (!this.currentStore.regionNodes[moduleName][currentCssNode][region]) {
         this.currentStore.regionNodes[moduleName][currentCssNode][region] = {};
      }
      this.currentStore.regionNodes[moduleName][currentCssNode][region][key] = value;
   }

   getRegionNode(moduleName, currentCssNode, region) {
      return this.currentStore.regionNodes[moduleName][currentCssNode][region];
   }

   getRegionNodes() {
      const result = {};
      Object.keys(this.currentStore.regionNodes).forEach((moduleName) => {
         Object.keys(this.currentStore.regionNodes[moduleName]).forEach((nodeName) => {
            result[nodeName] = this.currentStore.regionNodes[moduleName][nodeName];
         });
      });

      return result;
   }

   migrateRegionNode(moduleName, currentCssNode, region) {
      if (this.lastStore.regionNodes[moduleName]) {
         if (!this.currentStore.regionNodes[moduleName]) {
            this.currentStore.regionNodes[moduleName] = {};
         }

         if (this.lastStore.regionNodes[moduleName][currentCssNode]) {
            if (!this.currentStore.regionNodes[moduleName][currentCssNode]) {
               this.currentStore.regionNodes[moduleName][currentCssNode] = {};
            }

            this.currentStore.regionNodes[moduleName][currentCssNode][region] =
               this.lastStore.regionNodes[moduleName][currentCssNode][region];
         }
      }
   }

   getMissingThemes() {
      return this.currentStore.themesMeta.missingThemes;
   }

   setBaseThemeInfo(resultThemeName) {
      const { themes } = this.currentStore.themesMeta;
      if (!themes.hasOwnProperty(resultThemeName)) {
         themes[resultThemeName] = [];
      }
   }

   /**
    * adds meta info about current theme part into common cache
    * @param {String} resultThemeName - normalized theme name
    * (with modifier if exists, e.g. default__dark)
    * @param {String} relativePath - relative path of theme part
    * @param {boolean} newFile - whether this theme part is new
    */
   addThemePartIntoMeta(resultThemeName, relativePath) {
      const prettyRelativePath = toPosix(relativePath);
      const { themes, themesMap } = this.currentStore.themesMeta;
      if (!themes[resultThemeName].includes(prettyRelativePath)) {
         themes[resultThemeName].push(prettyRelativePath);
      }
      themesMap[prettyRelativePath] = resultThemeName;
   }

   storeFileExternalDependencies(moduleName, relativePath, depsToSave) {
      const prettyRelativePath = removeLeadingSlashes(
         toPosix(relativePath)
      );
      this.currentStore.inputPaths[moduleName].externalDependencies[prettyRelativePath] = [...depsToSave];
   }

   getFileExternalDependencies(moduleName, relativePath) {
      const prettyRelativePath = removeLeadingSlashes(
         toPosix(relativePath)
      );
      return this.currentStore.inputPaths[moduleName].externalDependencies[prettyRelativePath] || [];
   }

   getModuleExternalDepsCache(moduleName) {
      if (this.currentStore.inputPaths[moduleName]) {
         return this.currentStore.inputPaths[moduleName].externalDependencies;
      }
      return [];
   }

   getModuleExternalDepsList(moduleName) {
      const result = new Set([]);
      const currentFilesWithDeps = this.getModuleExternalDepsCache(moduleName);

      // generate a complete list of external deps for current interface module
      Object.keys(currentFilesWithDeps).forEach((currentFile) => {
         currentFilesWithDeps[currentFile].forEach(dep => result.add(dep));
      });
      return [...result];
   }

   /**
    *
    * @param {String} filePath - path to current file
    * @param {String} prettyRoot - current project root, needed if transmitted file path is absolute
    * @param {Array} themesParts - list of "theme.less" files that are to be rebuilt
    * @returns {*[]}
    */
   getAllFilesToBuild(filePath, prettyRoot, themesParts) {
      const filesToBuild = [filePath];
      const prettyFilePath = toPosix(filePath);
      const relativeFilePath = removeLeadingSlashes(
         prettyFilePath.replace(prettyRoot, '')
      );
      const { dependencies } = this.lastStore;
      Object.keys(dependencies).forEach((currentFile) => {
         if (dependencies[currentFile].includes(relativeFilePath)) {
            if (prettyRoot) {
               const fullPath = path.join(prettyRoot, currentFile);
               filesToBuild.push(fullPath);
               if (themesParts && path.basename(fullPath) === 'theme.less') {
                  themesParts.push(currentFile);
               }
            } else {
               filesToBuild.push(currentFile);
            }
         }
      });
      if (themesParts && path.basename(prettyFilePath) === 'theme.less' && !themesParts.includes(relativeFilePath)) {
         themesParts.push(relativeFilePath);
      }
      return filesToBuild;
   }

   /**
    * migrates theme meta from last store for current theme module
    * @param {ModuleInfo} moduleInfo - info about current module
    * @param {String} fullThemeName - full name of theme, e.g. Controls-default-theme/theme.less
    */
   migrateCurrentTheme(moduleInfo, fullThemeName) {
      const currentThemesMeta = this.currentStore.themesMeta;
      const lastThemesMeta = this.lastStore.themesMeta;
      const themeName = lastThemesMeta.themesMap[fullThemeName];
      const currentFallbackName = `${moduleInfo.name}/fallback.json`;
      if (themeName) {
         currentThemesMeta.themesMap[fullThemeName] = lastThemesMeta.themesMap[fullThemeName];
         if (!currentThemesMeta.themes[themeName]) {
            currentThemesMeta.themes[themeName] = [fullThemeName];
         } else {
            currentThemesMeta.themes[themeName].push(fullThemeName);
         }
      }
      const currentDefaultVariables = Object.keys(
         lastThemesMeta.fallbackList.variablesMap
      ).filter(
         currentVariable => lastThemesMeta.fallbackList.variablesMap[currentVariable] === currentFallbackName
      );
      currentDefaultVariables.forEach((currentVariable) => {
         if (!currentThemesMeta.fallbackList.variablesMap[currentVariable]) {
            currentThemesMeta.fallbackList.variablesMap[
               currentVariable
            ] = lastThemesMeta.fallbackList.variablesMap[currentVariable];
         }
         if (!currentThemesMeta.cssVariablesOptions.variables[currentVariable]) {
            currentThemesMeta.cssVariablesOptions.variables[
               currentVariable
            ] = lastThemesMeta.cssVariablesOptions.variables[currentVariable];
         }
      });
   }

   addCurrentModuleThemesMeta(moduleInfo, changedThemes) {
      const lastBuildSabyThemes = moduleInfo.cache.getLastSabyThemes();
      const normalizedDeletedFiles = moduleInfo.deletedFiles.map(
         currentFile => path.join(moduleInfo.name, currentFile)
      );
      if (!changedThemes) {
         const themesToMigrate = Object.keys(this.lastStore.themesMeta.themesMap)
            .filter(currentThemeName => currentThemeName.startsWith(`${moduleInfo.name}/`));
         themesToMigrate.forEach(currentTheme => this.migrateCurrentTheme(moduleInfo, currentTheme));

         Object.keys(lastBuildSabyThemes)
            .forEach((currentID) => {
               // если тема была удалена, мигрировать кеш для неё не нужно
               if (!normalizedDeletedFiles.includes(lastBuildSabyThemes[currentID].fileName)) {
                  moduleInfo.cache.migrateSabyTheme(currentID);
               }
            });
      } else {
         const themesToMigrate = Object.keys(this.lastStore.themesMeta.themesMap)
            .filter(currentThemeName => currentThemeName.startsWith(`${moduleInfo.name}/`) && !changedThemes.includes(currentThemeName));
         themesToMigrate.forEach(currentTheme => this.migrateCurrentTheme(moduleInfo, currentTheme));

         Object.keys(lastBuildSabyThemes)
            .filter(
               currentID => !(
                  changedThemes.includes(lastBuildSabyThemes[currentID].fileName) ||
                  normalizedDeletedFiles.includes(lastBuildSabyThemes[currentID].fileName)
               )
            )
            .forEach(currentID => moduleInfo.cache.migrateSabyTheme(currentID));
      }
   }

   migrateNotChangedFiles(moduleInfo, config) {
      const { outputName, changedFiles } = moduleInfo;

      if (changedFiles) {
         // use regular module files reader if there is no cache for current module
         if (!this.lastStore.inputPaths[outputName]) {
            return;
         }

         if (this.lastStore.regionNodes[outputName]) {
            // if current module has no changes, migrate its region nodes cache
            this.currentStore.regionNodes[outputName] = this.lastStore.regionNodes[outputName];
         }

         // if module has deleted locale file, we need to rebuild localization
         if (!moduleInfo.dropLocalizationCache) {
            moduleInfo.cache.migrateLocalizationCache();
         }

         // migrate the whole paths cache if there aren't any changes
         // in current interface module files
         const { paths, output } = this.lastStore.inputPaths[outputName];

         if (changedFiles.length === 0) {
            this.currentStore.inputPaths[outputName].paths = paths;
            this.currentStore.inputPaths[outputName].output = output;

            Object.keys(paths).forEach((currentPath) => {
               if (this.lastStore.dependencies[currentPath]) {
                  this.currentStore.dependencies[currentPath] = this.lastStore.dependencies[currentPath];
               }
               moduleInfo.cache.migrateCurrentFileCache(currentPath);
            });

            this.addCurrentModuleThemesMeta(moduleInfo);
         } else {
            const normalizedChangedFiles = processChangedFiles(this, config, moduleInfo, changedFiles);

            output.forEach((currentModule) => {
               if (!normalizedChangedFiles.includes(currentModule)) {
                  this.currentStore.inputPaths[outputName].output.push(currentModule);
               }
            });

            Object.keys(paths).forEach((currentPath) => {
               if (!normalizedChangedFiles.includes(currentPath)) {
                  this.currentStore.inputPaths[outputName].paths[currentPath] = paths[currentPath];

                  if (this.lastStore.inputPaths[outputName].output.includes(currentPath)) {
                     this.currentStore.inputPaths[outputName].output.push(currentPath);
                  }

                  moduleInfo.cache.migrateCurrentFileCache(currentPath);
                  const dependencies = this.getAllDependencies(currentPath);

                  dependencies.forEach((currentDependency) => {
                     const dependencyModuleName = transliterate(currentDependency.split('/').shift());

                     // migrate cache for only existing modules in project.
                     if (this.currentStore.inputPaths[dependencyModuleName]) {
                        const currentStorePaths = this.currentStore.inputPaths[dependencyModuleName].paths;
                        const lastStorePaths = this.lastStore.inputPaths[dependencyModuleName].paths;

                        if (!currentStorePaths[currentDependency] && lastStorePaths[currentDependency]) {
                           currentStorePaths[currentDependency] = lastStorePaths[currentDependency];
                           moduleInfo.cache.migrateCurrentFileCache(currentPath);
                        }
                     }
                  });
                  if (this.lastStore.dependencies[currentPath]) {
                     this.currentStore.dependencies[currentPath] = this.lastStore.dependencies[currentPath];
                  }
               }
            });

            this.addCurrentModuleThemesMeta(moduleInfo, normalizedChangedFiles);
         }
      }
   }

   getThemesMeta() {
      return this.currentStore.themesMeta;
   }

   getThemesMetaForWatcher() {
      return this.lastStore.themesMeta;
   }

   getLastModuleStatus(moduleName) {
      if (!this.lastStore.modulesStats) {
         return null;
      }
      return this.lastStore.modulesStats[moduleName];
   }

   addCssVariables(fallbackName, moduleVariables) {
      const variablesList = Object.keys(moduleVariables);

      // if current fallback.json is empty, there is no need in further calculations
      if (variablesList.length === 0) {
         return;
      }

      const { variables } = this.currentStore.themesMeta.cssVariablesOptions;
      const { fallbackList } = this.currentStore.themesMeta;

      variablesList.forEach((currentVariable) => {
         variables[currentVariable] = moduleVariables[currentVariable];
         fallbackList.variablesMap[currentVariable] = fallbackName;
      });
   }

   // checks overall css variables cache. If there are any changes sincle the last build,
   // all less cache will be dropped
   checkCurrentCssVariablesCache(moduleName, currentCssVariables) {
      const { fallbackList } = this.currentStore.themesMeta;

      let LAST_MODULE_HASH;
      if (this.lastStore.themesMeta.hasOwnProperty('fallbackList')) {
         if (this.lastStore.themesMeta.fallbackList.hasOwnProperty('hashes')) {
            LAST_MODULE_HASH = this.lastStore.themesMeta.fallbackList.hashes[moduleName] || '';
         }
      } else {
         LAST_MODULE_HASH = '';
      }
      this.setCurrentCssVariablesCache(moduleName, currentCssVariables);
      if (
         LAST_MODULE_HASH &&
         fallbackList.hashes[moduleName] !== LAST_MODULE_HASH
      ) {
         // if overall list of css variables and it's values is changed, drop cache of all
         // less
         const reason = `Для модуля ${moduleName} изменился набор css-переменных. Кеш css переменных будет сброшен.`;
         logger.info(reason);
         this.setDropCacheForLess();
         if (!this.cacheForLessIsDropped()) {
            getMetricsReporter().onCacheDrop('less', reason);
            hooks.executeHook('dropCacheHook', ['less', reason]);
         }
      }
   }

   setCurrentCssVariablesCache(moduleName, currentCssVariables) {
      const { fallbackList } = this.currentStore.themesMeta;

      fallbackList.hashes[moduleName] = helpers.calcHash(JSON.stringify(currentCssVariables), 'base64');
   }

   getCssVariablesoptions() {
      return this.currentStore.themesMeta.cssVariablesOptions;
   }

   /**
    * Добавляет в кеш информацию о дополнительных генерируемых файлах.
    * Это нужно, чтобы в финале инкрементальной сборки удалить только не актуальные файлы.
    * @param {string} filePath путь до файла
    * @param {string} outputFilePath путь до генерируемого файла.
    * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow.
    */
   addOutputFile(filePath, outputFilePath, moduleInfo) {
      const prettyRoot = toPosix(moduleInfo.appRoot);
      const prettyOutput = path.dirname(moduleInfo.output);
      const prettyRelativePath = getRelativePath(prettyRoot, filePath);
      const outputPrettyRelativePath = getRelativePath(prettyOutput, outputFilePath);

      if (!this.currentStore.inputPaths[moduleInfo.outputName]) {
         return;
      }

      const { paths } = this.currentStore.inputPaths[moduleInfo.outputName];
      if (paths.hasOwnProperty(prettyRelativePath)) {
         if (!paths[prettyRelativePath].output.includes(outputPrettyRelativePath)) {
            paths[prettyRelativePath].output.push(outputPrettyRelativePath);
         }

         // add archives into input-paths cache, it could be useful for a garbage collector that removes
         // unneeded artifacts of removed sources.
         const outputExt = path.extname(outputFilePath);

         if (
            this.config.compress &&
            (outputFilePath.endsWith(`.min${outputExt}`) || outputExt === '.svg') &&
            COMPRESSED_EXTENSIONS.has(outputExt) &&
            !paths[prettyRelativePath].output.includes(`${outputPrettyRelativePath}.gz`)
         ) {
            paths[prettyRelativePath].output.push(`${outputPrettyRelativePath}.gz`);
            paths[prettyRelativePath].output.push(`${outputPrettyRelativePath}.br`);
         }
      } else if (!this.currentStore.inputPaths[moduleInfo.outputName].output.includes(outputPrettyRelativePath)) {
         // некоторые файлы являются производными от всего модуля. например en-US.js, en-US.css
         this.currentStore.inputPaths[moduleInfo.outputName].output.push(outputPrettyRelativePath);
      }
   }

   /**
    * Creates a hash by content for current file
    * @param filePath
    * @param fileContents
    */
   createContentHash(filePath, fileContents) {
      this.currentStore.cachedMinified[filePath] = helpers.calcHash(fileContents, 'base64');
   }

   // returns react mode from builder's cache.
   // 'release' is default value.
   getReactMode() {
      return this.config.reactMode || this.lastStore.reactMode || 'release';
   }

   shouldCreateTscReport() {
      return this.config.tscReport || this.lastStore.tscReport || false;
   }

   /**
    * Returns a hash by content for a given relative file path
    * @param relativePath
    * @returns {*}
    */
   getHash(moduleInfo, relativePath) {
      const prettyRelativePath = toPosix(relativePath);
      const currentFileCache = this.currentStore.inputPaths[moduleInfo.outputName].paths[prettyRelativePath];

      /**
       * if there is no saved cache for current file
       * it could mean that this file was generated in some
       * builder plugin without origin source(f.e. joined css
       * localization, created by plugin with using of current
       * interface module localization styles)
       */
      if (!currentFileCache) {
         return '';
      }
      return currentFileCache.hash;
   }

   /**
    * checks file hash to be equal as previously generated in cache
    * Needed for incremental build.
    * @param {String} filePath - full path of current file
    * @returns {boolean}
    */
   minifiedIsCached(filePath) {
      return this.currentStore.cachedMinified[filePath] === this.lastStore.cachedMinified[filePath];
   }

   getCachedMinified() {
      return this.currentStore.cachedMinified;
   }

   getOutputForFile(filePath, moduleInfo) {
      const prettyRoot = toPosix(moduleInfo.appRoot);
      const prettyRelativeFilePath = getRelativePath(prettyRoot, filePath);
      if (this.currentStore.inputPaths[moduleInfo.outputName].paths.hasOwnProperty(prettyRelativeFilePath)) {
         return this.currentStore.inputPaths[moduleInfo.outputName].paths[prettyRelativeFilePath].output;
      }
      return [];
   }

   /**
    * Получить список файлов из исходников, которые относятся к конкретному модулю
    * @param {string} moduleName путь до модуля
    * @returns {string[]}
    */
   getInputPathsByFolder(moduleName) {
      return Object.keys(this.currentStore.inputPaths[moduleName].paths);
   }

   /**
    * Stores failed files
    * @param {String} moduleName - name of interface module
    * @param {Array} failedFiles - list of failed files
    */
   storeFailedFiles(moduleName, failedFiles) {
      if (!this.currentStore.filesWithErrors[moduleName]) {
         this.currentStore.filesWithErrors[moduleName] = new Set();
      }

      failedFiles.forEach(relPath => this._addFileWithErrors(moduleName, relPath));
   }

   /**
    * Пометить файл как ошибочный, чтобы при инкрементальной сборке обработать его заново.
    * Что-то могло поменятся. Например, в less может поменятся файл, который импортируем.
    * @param {string} relativePath относительный путь от корня модуля, включая имя модуля
    */
   markFileAsFailed(relativePath) {
      const [moduleName, relPath] = splitRelativePath(relativePath);

      if (!this.currentStore.filesWithErrors[moduleName]) {
         this.currentStore.filesWithErrors[moduleName] = new Set();
      }

      this._addFileWithErrors(moduleName, relPath);
   }

   /**
    * Adds file with errors
    * @param {String} moduleName - name of current interface module
    * @param {String} relativePath
    * @private
    */
   _addFileWithErrors(moduleName, relativePath) {
      this.currentStore.filesWithErrors[moduleName].add(relativePath);

      if (relativePath.match(TS_EXT)) {
         this.currentStore.failedTypescriptModules.add(moduleName);
      }
   }

   getFailedFiles(moduleName) {
      if (!this.currentStore.filesWithErrors[moduleName]) {
         this.currentStore.filesWithErrors[moduleName] = new Set();
      }

      return Array.from(this.currentStore.filesWithErrors[moduleName]);
   }

   hasTypescriptErrors() {
      return this.lastStore.failedTypescriptModules.size > 0;
   }

   get failedTypescriptModules() {
      return Array.from(this.lastStore.failedTypescriptModules);
   }

   markCacheAsFailed() {
      this.currentStore.runningParameters.criticalErrors = true;
   }

   /**
    * Добавить информацию о зависимостях файла. Это нужно для инкрементальной сборки, чтобы
    * при изменении файла обрабатывать другие файлы, которые зависят от текущего.
    * @param {string} filePath путь до исходного файла
    * @param {string} imports список зависимостей (пути до исходников)
    */
   addDependencies(root, filePath, imports) {
      const prettyRoot = toPosix(root);
      const prettyRelativePath = removeLeadingSlashes(
         toPosix(filePath).replace(prettyRoot, '')
      );
      if (!this.currentStore.dependencies.hasOwnProperty(prettyRelativePath)) {
         this.currentStore.dependencies[prettyRelativePath] = [];
      }

      // add new imports into less dependencies
      imports.forEach((currentImport) => {
         const prettyRelativeImport = removeLeadingSlashes(
            toPosix(currentImport).replace(prettyRoot, '')
         );
         if (!this.currentStore.dependencies[prettyRelativePath].includes(prettyRelativeImport)) {
            this.currentStore.dependencies[prettyRelativePath].push(prettyRelativeImport);
         }
      });
   }

   getDependencies(relativePath) {
      const prettyRelativePath = toPosix(relativePath);
      return this.currentStore.dependencies[prettyRelativePath] || [];
   }

   getCompiledDependencies(relativePath) {
      const prettyRelativePath = toPosix(relativePath);
      return this.compiledStore.dependencies[prettyRelativePath];
   }

   getCompiledHash(moduleInfo, relativePath) {
      const prettyRelativePath = toPosix(relativePath);

      // get compiled hash only for interface module that exists in compiled
      // cache, otherwise build source file as usual
      if (
         this.compiledStore.inputPaths.hasOwnProperty(moduleInfo.outputName) &&
         this.compiledStore.inputPaths[moduleInfo.outputName].paths[prettyRelativePath]
      ) {
         return this.compiledStore.inputPaths[moduleInfo.outputName].paths[prettyRelativePath].hash;
      }
      return '';
   }

   compareWithCompiled(moduleInfo, relativePath) {
      const compiledHash = this.getCompiledHash(moduleInfo, relativePath);
      if (compiledHash && this.getHash(moduleInfo, relativePath) === compiledHash) {
         return true;
      }
      return false;
   }

   /**
    * Проверить изменились ли зависимости текущего файла
    * @param {string} filePath путь до файла
    * @returns {Promise<boolean>}
    */
   async _isDependenciesChanged(hashByContent, relativePath, root) {
      const dependencies = this.getAllDependencies(relativePath);
      if (dependencies.length === 0) {
         return false;
      }
      const listChangedDeps = await pMap(
         dependencies,
         async(currentRelativePath) => {
            const moduleName = transliterate(currentRelativePath.split('/').shift());

            // Если кеша для вычисленного модуля не нашлось, это может быть в 2 ситуациях:
            // 1) специфическая зависимость - require, exports(при компиляции ts-файлов)
            // 2) зависимость от модуля, которого в текущей сборке нету.
            // И в том и другом случае зависимость никак не влияет на принятие решения о том,
            // изменился ли файл или нет.
            if (!this.lastStore.inputPaths[moduleName]) {
               return false;
            }
            const lastStorePaths = this.lastStore.inputPaths[moduleName].paths;
            if (this.cacheChanges.hasOwnProperty(currentRelativePath)) {
               return this.cacheChanges[currentRelativePath];
            }
            if (
               !lastStorePaths.hasOwnProperty(currentRelativePath) ||
               !lastStorePaths[currentRelativePath].hash
            ) {
               return true;
            }
            let isChanged = false;
            const currentPath = path.join(root, currentRelativePath);
            if (await fs.pathExists(currentPath)) {
               if (hashByContent) {
                  // gulp.src reader removes BOM from file contents, so we need to do
                  // the same thing
                  const fileContents = await fs.readFile(currentPath, 'utf8');
                  const hash = helpers.calcHash(Buffer.from(fileContents.replace(/^\uFEFF/, '')), 'base64');
                  isChanged = lastStorePaths[currentRelativePath].hash !== hash;
               } else {
                  const fileStats = await fs.stat(currentRelativePath);
                  isChanged = lastStorePaths[currentRelativePath].hash !== fileStats.mtime.toString();
               }
            } else {
               isChanged = true;
            }
            this.cacheChanges[currentRelativePath] = isChanged;
            return isChanged;
         },
         {
            concurrency: 20
         }
      );
      return listChangedDeps.some(changed => changed);
   }

   /**
    * Получить все зависмости файла
    * @param {string} filePath путь до файла
    * @returns {string[]}
    */
   getAllDependencies(filePath) {
      const prettyPath = toSafePosix(filePath);
      const results = new Set();
      const queue = [prettyPath];

      while (queue.length > 0) {
         const currentPath = queue.pop();
         if (this.lastStore.dependencies.hasOwnProperty(currentPath)) {
            for (const dependency of this.lastStore.dependencies[currentPath]) {
               if (!results.has(dependency)) {
                  results.add(dependency);
                  queue.push(dependency);
               }
            }
         }
      }
      return Array.from(results);
   }

   deleteFailedFromCacheInputs(filePath, moduleInfo) {
      const prettyRoot = toPosix(moduleInfo.appRoot);
      const prettyRelativePath = getRelativePath(prettyRoot, filePath);
      if (this.currentStore.inputPaths[moduleInfo.outputName].paths.hasOwnProperty(prettyRelativePath)) {
         delete this.currentStore.inputPaths[moduleInfo.outputName].paths[prettyRelativePath];
      }
   }

   setDropCacheForLess() {
      this.dropCacheForLess = true;
   }

   cacheForLessIsDropped() {
      return this.dropCacheForLess;
   }

   /**
    * Установить признак того, что верстку нужно скомпилировать заново.
    * Это случается, если включена локализация и какой-либо класс в jsdoc поменялся.
    */
   setDropCacheForMarkup() {
      this.dropCacheForMarkup = true;
   }

   setDropCacheForOldMarkup() {
      this.dropCacheForOldMarkup = true;
   }

   setDropCacheForStaticMarkup() {
      this.dropCacheForStaticMarkup = true;
   }

   setDropCacheForMetatypes() {
      this.dropCacheForMetatypes = true;
   }

   markupCacheIsDropped() {
      return this.dropCacheForMarkup || this.dropCacheForOldMarkup;
   }


   /**
    * Сохраняем moduleDependencies конкретного модуля в общий для проекта moduleDependencies
    * @param {{links: {}, nodes: {}, packedLibraries: {}}} obj Объект moduleDependencies конкретного модуля
    */
   storeLocalModuleDependencies(obj) {
      this.moduleDependencies = {
         links: { ...this.moduleDependencies.links, ...obj.links },
         nodes: { ...this.moduleDependencies.nodes, ...obj.nodes },
         packedLibraries: { ...this.moduleDependencies.packedLibraries, ...obj.packedLibraries },
      };
   }

   /**
    * Получить общий для проекта moduleDependencies
    * @returns {{links: {}, nodes: {}}}
    */
   getModuleDependencies() {
      return this.moduleDependencies;
   }

   /**
    * stores updated module-dependencies meta.
    * e.g. lazy bundles results have to be stored in builder cache
    * for further debugging if it's necessary
    * @returns {Promise<void>}
    */
   async storeModuleDependencies() {
      await fs.outputJson(path.join(this.config.cachePath, 'module-dependencies.json'), this.moduleDependencies);
   }

   /**
    * get files list to remove by deleted files list that was
    * transmitted through gulp_config
    */
   getListForRemoveByDeletedFiles(cachePath, outputPath, deletedFiles) {
      const deletedFilesSet = this.lastStore.getOutputFilesSetForDeletedFiles(deletedFiles, this.isFirstBuild());
      let removeFiles = Array.from(deletedFilesSet)
         .map(relativeFilePath => path.join(cachePath, relativeFilePath));

      if (outputPath !== cachePath) {
         removeFiles = [...removeFiles, ...removeFiles.map(currentFile => currentFile.replace(cachePath, outputPath))];
      }
      return removeFiles.filter(filePath => !!filePath);
   }

   /**
    * Get list of files to remove from output directory after incremental build
    * @param {String} cachePath - path to builder's cache
    * @param {String} outputPath - path to output directory
    * @returns {Promise<*>}
    */
   async getListForRemoveFromOutputDir(cachePath, outputPath) {
      const currentOutputSet = this.currentStore.getOutputFilesSet();
      const lastOutputSet = this.lastStore.getOutputFilesSet();
      let removeFiles = Array.from(lastOutputSet)
         .filter(relativeFilePath => !currentOutputSet.has(relativeFilePath))
         .map(relativeFilePath => path.join(cachePath, relativeFilePath));

      // in case of release mode there are 2 folder to remove outdated files therefrom:
      // 1) cache directory
      // 2) output directory
      // We need to remove it from these directories
      if (outputPath !== cachePath) {
         removeFiles = [...removeFiles, ...removeFiles.map(currentFile => currentFile.replace(cachePath, outputPath))];
      }
      const results = await pMap(
         removeFiles,
         async(filePath) => {
            let needRemove = false;
            let stat = null;
            try {
               // fs.access и fs.pathExists не правильно работают с битым симлинками
               // поэтому сразу используем fs.lstat
               stat = await fs.lstat(filePath);
            } catch (e) {
               // ничего нелать не нужно
            }

            // если файл не менялся в текущей сборке, то его нужно удалить
            // файл может менятся в случае если это, например, пакет из нескольких файлов
            if (stat) {
               needRemove = stat.mtime.getTime() < this.currentStore.startBuildTime;
            }

            return {
               filePath,
               needRemove
            };
         },
         {
            concurrency: 20
         }
      );
      return results
         .map((obj) => {
            if (obj.needRemove) {
               return obj.filePath;
            }
            return null;
         })
         .filter(filePath => !!filePath);
   }
}

module.exports = Cache;
