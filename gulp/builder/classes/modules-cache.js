/**
 * Class for module cache
 * @author Kolbeshin F.A.
 */

'use strict';

const { FILE_CONTENTS_CACHE, COMMON_CACHE_PROPERTIES } = require('../../../lib/builder-cache-constants');
const { path, toSafePosix, toPosix } = require('../../../lib/platform/path');
const fs = require('fs-extra');
const logger = require('../../../lib/logger').logger();
const { sortObject, moduleHasNoChanges } = require('../../../lib/helpers');
const { normalizeFile } = require('../../../lib/changed-files/configuration');
const withLockfile = require('../../../lib/with-lockfile');

const CACHE_PROPERTIES = new Set([
   ...FILE_CONTENTS_CACHE,
   ...COMMON_CACHE_PROPERTIES,
   'externalDependencies'
]);

/**
 * fills store with missing cache properties
 * needed for compatibility with previous builds if
 * there is new type of cache in new builder added.
 * @param {StoreInfo} store - current store(lastCache or currentCache)
 */
function fillRemainingProperties(store) {
   if (store) {
      CACHE_PROPERTIES.forEach((currentProperty) => {
         if (!store.hasOwnProperty(currentProperty)) {
            store[currentProperty] = {};
         }
      });
   }
}

function setDefaultStore() {
   const result = { };

   CACHE_PROPERTIES.forEach((currentProperty) => {
      result[currentProperty] = {};
   });

   return result;
}

function getSvgCacheByStore(svgCache) {
   const result = {};
   Object.keys(svgCache).forEach((currentSvg) => {
      const svgPathParts = currentSvg.split('/');
      if (svgPathParts.length >= 3) {
         const { iconPostfix } = svgCache[currentSvg];

         // get svg package name as a 1 level directory of icons
         const packageName = `${svgPathParts[1]}${iconPostfix ? `_${iconPostfix}` : ''}`;
         if (!result[packageName]) {
            result[packageName] = [{
               path: currentSvg,
               content: svgCache[currentSvg]
            }];
         } else {
            result[packageName].push({
               path: currentSvg,
               content: svgCache[currentSvg]
            });
         }
      }
   });
   return result;
}

class ModuleCache {
   /**
    * Инициализировать инстанс кеша модуля.
    * @param {object} lastStore Сохраненное на диск состояние кеша модуля.
    */
   constructor(lastStore) {
      this.markupProperties = ['text', 'nodeName', 'dependencies', 'versioned', 'cdnLinked'];

      fillRemainingProperties(lastStore);

      this.lastStore = lastStore || setDefaultStore();
      this.currentStore = setDefaultStore();
      this.tsCompileCache = {};
   }

   /**
    * removes all properties have been transmitted from templates processor but there is
    * no further need of them in builder's cache.
    * @param object
    */
   removeUnnededProperties(object) {
      for (const property in object) {
         if (object.hasOwnProperty(property) && !this.markupProperties.includes(property)) {
            delete object[property];
         }
      }
   }

   /**
    * Получить информацию о JS компонентах модуля
    * @returns {Object<string,Object>} Информация о JS компонентах модуля в виде
    *    {
    *       <путь до файла>: <информация о компоненте>
    *    }
    */
   getComponentsInfo() {
      return this.currentStore.componentsInfo;
   }

   /**
    * Get full info about current component from cache storage
    * @param {String} filePath - full path to file
    * @returns {*}
    */
   getCurrentComponentInfo(relativePath) {
      const prettyRelativePath = toPosix(relativePath);
      return this.currentStore.componentsInfo[prettyRelativePath];
   }

   storeLocalizationMeta(meta) {
      this.currentStore.localizationMeta = meta;
   }

   getLocalizationMeta() {
      return this.currentStore.localizationMeta;
   }

   migrateLocalizationCache() {
      this.currentStore.localizationMeta = this.lastStore.localizationMeta;
   }

   /**
    * Сохранить в кеше скомпилированную верстку xhtml или tmpl. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {Object} obj Объект с полями text, nodeName (имя файла для require) и dependencies
    */
   storeBuildedMarkup(filePath, obj) {
      const prettyPath = toSafePosix(filePath);
      this.removeUnnededProperties(obj);
      this.currentStore.markupCache[prettyPath] = obj;
   }

   storeSabyTheme(id, data) {
      this.currentStore.sabyThemes[id] = data;
   }

   migrateSabyTheme(id) {
      this.currentStore.sabyThemes[id] = this.lastStore.sabyThemes[id];
   }

   getSabyTheme(id) {
      return this.currentStore.sabyThemes[id];
   }

   getSabyThemes() {
      return this.currentStore.sabyThemes;
   }

   getLastSabyThemes() {
      return this.lastStore.sabyThemes;
   }

   storeChangedAndDeletedFiles(changedFiles, deletedFiles) {
      this.currentStore.changedFiles = changedFiles || [];
      this.currentStore.deletedFiles = deletedFiles || [];
   }

   storeFailedFiles(filesWithErrors) {
      this.currentStore.filesWithErrors = filesWithErrors || [];
   }

   getFailedFiles() {
      return this.lastStore.filesWithErrors || [];
   }


   /**
    * Сохранить в кеше скомпилированный ES-модуль. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {Object} obj Объект с полями text, nodeName (имя файла для require) и dependencies
    */
   storeCompiledES(filePath, obj) {
      const prettyPath = toSafePosix(filePath);
      this.tsCompileCache[prettyPath] = {
         ...(this.tsCompileCache[prettyPath] || { }),
         ...obj
      };
   }

   storeSvgContent(relativePath, content, skipClean, iconPostfix) {
      const prettyPath = toPosix(relativePath);
      this.currentStore.svgCache[prettyPath] = {
         content,
         skipClean,
         iconPostfix
      };
   }

   getCurrentSvgPackagesMeta() {
      const { svgCache } = this.currentStore;
      return getSvgCacheByStore(svgCache);
   }

   getLastSvgPackagesMeta() {
      const { svgCache } = this.lastStore;
      return getSvgCacheByStore(svgCache);
   }

   getLastChangedFilesMeta() {
      return {
         lastChangedFiles: this.lastStore.changedFiles,
         lastDeletedFiles: this.lastStore.deletedFiles
      };
   }

   migrateCurrentFileCache(currentPath) {
      const prettyPath = toPosix(currentPath);

      CACHE_PROPERTIES.forEach((currentProperty) => {
         if (this.lastStore[currentProperty][prettyPath]) {
            this.currentStore[currentProperty][prettyPath] = this.lastStore[currentProperty][prettyPath];
         }
      });
   }

   /**
    * Получить всю скомпилированную верстку для конкретного модуля
    * @returns {Object} Информация о скомпилированной верстки модуля в виде
    *    {
    *       <путь до файла>: {
    *          text: <js код>
    *          nodeName: <имя файла для require>,
    *          dependencies: [...<зависимости>]
    *       }
    *    }
    */
   getMarkupCache() {
      return this.currentStore.markupCache;
   }

   /**
    * Получить все скомпилированные ES модули для конкретного интерфейсного модуля.
    * @returns {Object} Информация о скомпилированном ES модуле в виде
    *    {
    *       <путь до файла>: {
    *          text: <js код>
    *          nodeName: <имя файла для require>
    *       }
    *    }
    */
   getCompiledTsModuleCache() {
      return this.tsCompileCache;
   }

   /**
    * Получить всю информацию о роутингах для конкретного модуля
    * @returns {Object} Информация о роутингах модуля в виде
    *    {
    *       <путь до файла>: {...<роунги файла>}
    *    }
    */
   getRoutesInfo() {
      return this.currentStore.routesInfo;
   }

   /**
    * Сохранить информацию о js компоненте после парсинга для использования в повторной сборке.
    * @param {string} filePath путь до файла
    * @param {Object} componentInfo объект с информацией о компоненте
    */
   storeComponentInfo(relativePath, componentInfo) {
      const prettyRelativePath = toPosix(relativePath);
      if (componentInfo) {
         this.currentStore.componentsInfo[prettyRelativePath] = componentInfo;
      }
   }


   storeComponentParameters(relativePath, additionalParameters) {
      const prettyRelativePath = toPosix(relativePath);
      if (this.currentStore.componentsInfo[prettyRelativePath]) {
         Object.keys(additionalParameters).forEach((currentKey) => {
            this.currentStore.componentsInfo[prettyRelativePath][currentKey] = additionalParameters[currentKey];
         });
      }
   }

   /**
    * Сохранить информацию о роутинге после парсинга для использования в повторной сборке.
    * @param {string} filePath путь до файла
    * @param {Object} routeInfo объект с информацией о роутинге
    */
   storeRouteInfo(filePath, routeInfo) {
      const prettyPath = toSafePosix(filePath);
      if (routeInfo) {
         this.currentStore.routesInfo[prettyPath] = routeInfo;
      }
   }

   migrateLastChangedFilesMeta(taskParameters, moduleInfo) {
      // if changedFiles is disabled, ignore this stage
      if (moduleInfo.changedFiles instanceof Array) {
         const {
            lastChangedFiles,
            lastDeletedFiles
         } = this.getLastChangedFilesMeta();
         let currentChangedFiles = taskParameters.config.getFullModuleChangedFilesList(moduleInfo.outputName);
         const lastBuildStatus = taskParameters.cache.getLastModuleStatus(moduleInfo.name);
         const normalizedDeletedFiles = moduleInfo.deletedFiles.map(
            currentFile => normalizeFile(moduleInfo, currentFile)
         );
         currentChangedFiles = currentChangedFiles.filter(currentFile => !normalizedDeletedFiles.includes(currentFile));

         // нужно пересобрать все файлы модуля, которые участвовали в предыдущей сборке, если данный
         // модуль был собран с ошибками
         if (lastBuildStatus === 'FAILED' && currentChangedFiles) {
            if (lastChangedFiles) {
               lastChangedFiles.forEach((currentFile) => {
                  if (!currentChangedFiles.includes(currentFile)) {
                     currentChangedFiles.push(currentFile);
                  }
               });
            }

            /**
             * Если сборка модуля была завершена с ошибкой, wasaby-cli не обновляет гитовое состояние модуля и в
             * последующей сборке заново передаст те же самые изменения, но есть исключение - когда в сборку
             * пришла следующая ветка, тогда изменения будут совсем другие. Отсюда возникает кейс, когда билдер
             * удалил файл(как ему и передали), из за этого упала ошибка, а в будущем билде он получил совсем другие
             * изменения, поскольку на сборку пришла другая ветка. Чтобы учесть данный кейс, мы будем сами пересобирать
             * все удалённые файлы в прошлой сборке, но кроме тех, которые в текущей сборке переданы как удалённые.
             */
            if (lastDeletedFiles) {
               lastDeletedFiles.forEach((currentFile) => {
                  if (!moduleInfo.deletedFiles.includes(currentFile)) {
                     const normalizedFile = normalizeFile(moduleInfo, currentFile);
                     if (!currentChangedFiles.includes(normalizedFile)) {
                        currentChangedFiles.push(normalizedFile);
                     }
                  }
               });
            }

            taskParameters.config.setFullModuleChangedFilesList(moduleInfo.outputName, currentChangedFiles);
         }
      }
   }
}

/**
 * Read cache from disk if it exists
 * @param moduleCachePath - path to current cache
 * @returns {Promise<null>}
 */
async function getLastModuleCache(moduleCachePath) {
   if (await fs.pathExists(moduleCachePath)) {
      return fs.readJson(moduleCachePath);
   }

   return null;
}

/**
 * Task for getting saved module cache from disk if needed
 * @param taskParameters - whole parameters list of current project build
 * @param moduleInfo - main info about current module
 * @returns {downloadModuleCache}
 */
function generateReadModuleCache(taskParameters, moduleInfo, singleFileBuild) {
   moduleInfo.compiledFiles = [];
   moduleInfo.cachePath = path.join(moduleInfo.output, '.cache/components-info.json');

   return async function readModuleCache() {
      let lastCache;

      // load current module cache if current build isn't a first one
      // and cache is still compatible since last build
      if (taskParameters.cache.isCacheNeeded()) {
         const lockFilePath = withLockfile.toFileName(taskParameters.config.cachePath, moduleInfo.outputName);

         await withLockfile(lockFilePath, async() => {
            lastCache = await getLastModuleCache(moduleInfo.cachePath);
         });
      }

      moduleInfo.cache = new ModuleCache(lastCache);

      if (lastCache && singleFileBuild) {
         moduleInfo.cache.currentStore = moduleInfo.cache.lastStore;
      }

      if (!taskParameters.cache.grabber) {
         if (moduleInfo.changedFiles) {
            moduleInfo.cache.migrateLastChangedFilesMeta(taskParameters, moduleInfo);
         }

         taskParameters.cache.migrateNotChangedFiles(moduleInfo, taskParameters.config);
      }
   };
}

function getCurrentThemesMap(moduleInfo, themesMap) {
   const result = {};

   Object.keys(themesMap).forEach((currentTheme) => {
      if (currentTheme.startsWith(`${moduleInfo.name}/`)) {
         result[currentTheme] = themesMap[currentTheme];
      }
   });

   return result;
}

/**
 * Task for saving current module cache on disk
 * @param moduleInfo - main info about current module
 * @returns {saveModuleCache}
 */
function generateWriteModuleCache(taskParameters, moduleInfo) {
   return async function writeModuleCache() {
      if (!moduleInfo.cache) {
         logger.warning(`Attempted to write module cache for "${moduleInfo.name}" that has been deleted`);
         return;
      }

      try {
         // перегенерировать помодульный themesMap.json имеет смысл только в том случае,
         // если есть какие-либо изменения в темах
         if (
            moduleInfo.newThemesModule &&
            !moduleHasNoChanges(moduleInfo, [moduleInfo.themeChanged])
         ) {
            const currentThemesMap = getCurrentThemesMap(moduleInfo, taskParameters.cache.getThemesMeta().themesMap);
            await fs.outputJson(path.join(moduleInfo.output, 'themesMap.json'), sortObject(currentThemesMap));
            taskParameters.addFilesToCopy(moduleInfo.outputName, ['themesMap.json']);
         }

         const markupCache = moduleInfo.cache.getMarkupCache();
         Object.keys(markupCache).forEach((currentPath) => {
            delete markupCache[currentPath].text;
         });
         moduleInfo.cache.storeChangedAndDeletedFiles(
            taskParameters.config.changedFilesWithDependencies[moduleInfo.name],
            moduleInfo.deletedFiles
         );

         moduleInfo.cache.storeFailedFiles(taskParameters.cache.getFailedFiles(moduleInfo.name));

         const lockFilePath = withLockfile.toFileName(taskParameters.config.cachePath, moduleInfo.outputName);

         await withLockfile(lockFilePath, async() => {
            await fs.outputJson(moduleInfo.cachePath, sortObject(moduleInfo.cache.currentStore));
         });

         delete moduleInfo.cache;
         delete moduleInfo.compiledFiles;
      } catch (error) {
         logger.warning(`Could not save cache for module ${moduleInfo.name}. Error: ${error}`);
      }
   };
}

module.exports = ModuleCache;
module.exports.generateReadModuleCache = generateReadModuleCache;
module.exports.generateWriteModuleCache = generateWriteModuleCache;
