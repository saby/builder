/**
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toSafePosix } = require('../../../lib/platform/path');
const fs = require('fs-extra'),
   assert = require('assert'),
   pMap = require('p-map'),
   crypto = require('crypto');
const packageJson = require('../../../package.json'),
   logger = require('../../../lib/logger').logger(),
   StoreInfo = require('./store-info');

/**
 * Класс кеша для сбора локализуемых фраз
 */
class Cache {
   constructor(config) {
      this.config = config;
      this.lastStore = new StoreInfo();
      this.currentStore = new StoreInfo();
      this.currentStore.runningParameters = this.config.rawConfig;
      this.currentStore.versionOfBuilder = packageJson.version;
      this.currentStore.startBuildTime = new Date().getTime();

      this.filePath = path.join(this.config.cachePath, 'grabber-cache.json');

      // если хоть 1 json описания компонента поменялся, то нужно обрабатывать xhtml и tmpl заново
      this.dropCacheForMarkup = false;

      this.grabber = true;
   }

   load() {
      return this.lastStore.load(this.filePath);
   }

   save() {
      return this.currentStore.save(this.filePath);
   }

   cacheHasIncompatibleChanges() {
      const finishText = 'Кеш будет очищен.';
      if (this.lastStore.versionOfBuilder === 'unknown') {
         logger.info('Не удалось обнаружить валидный кеш.');
         return true;
      }
      try {
         assert.deepStrictEqual(this.lastStore.runningParameters, this.currentStore.runningParameters);
      } catch (error) {
         logger.info(`Параметры запуска builder'а поменялись. ${finishText}`);
         return true;
      }

      // новая версия билдера может быть полностью не совместима
      const isNewBuilder = this.lastStore.versionOfBuilder !== this.currentStore.versionOfBuilder;
      if (isNewBuilder) {
         logger.info(`Версия builder'а не соответствует сохранённому значению в кеше. ${finishText}`);
         return true;
      }

      return false;
   }

   async clearCacheIfNeeded() {
      const filesForRemove = [];
      const logsToSave = [];
      if (this.cacheHasIncompatibleChanges(logsToSave)) {
         this.lastStore = new StoreInfo();

         // из кеша можно удалить всё кроме .lockfile
         if (await fs.pathExists(this.config.cachePath)) {
            for (const fullPath of await fs.readdir(this.config.cachePath)) {
               if (!fullPath.endsWith('.lockfile')) {
                  filesForRemove.push(fullPath);
               }
            }
         }
      }

      logsToSave.forEach(currentLog => logger.info(currentLog));

      return pMap(filesForRemove, filePath => fs.remove(filePath), {
         concurrency: 20
      });
   }

   /**
    * Проверяет нужно ли заново обрабатывать файл или можно ничего не делать.
    * @param {string} filePath путь до файла
    * @param {Buffer} fileContents содержимое файла
    * @returns {boolean}
    */
   isFileChanged(filePath, fileContents) {
      // папки не меняются
      if (!fileContents) {
         return false;
      }
      const prettyPath = toSafePosix(filePath);
      const hash = crypto.createHash('sha1').update(fileContents).digest('base64');
      const isChanged = this._isFileChanged(prettyPath, hash);

      if (!isChanged) {
         this.currentStore.cachedFiles[prettyPath] = this.lastStore.cachedFiles[prettyPath];
      } else {
         this.currentStore.cachedFiles[prettyPath] = {
            words: [],
            hash
         };
      }

      return isChanged;
   }

   _isFileChanged(prettyPath, hash) {
      // кеша не было, значит все файлы новые
      if (!this.lastStore.startBuildTime) {
         return true;
      }

      // новый файл
      if (!this.lastStore.cachedFiles.hasOwnProperty(prettyPath)) {
         return true;
      }

      // dropCacheForMarkup устанавливается по результатам генерации json
      if (this.dropCacheForMarkup && (prettyPath.endsWith('.tmpl') || prettyPath.endsWith('.wml'))) {
         return true;
      }

      if (this.dropCacheForOldMarkup && prettyPath.endsWith('.xhtml')) {
         return true;
      }

      return this.lastStore.cachedFiles[prettyPath].hash !== hash;
   }

   setDropCacheForMarkup() {
      this.dropCacheForMarkup = true;
   }

   setDropCacheForOldMarkup() {
      this.dropCacheForOldMarkup = true;
   }

   setDropCacheForStaticMarkup() {
      this.dropCacheForStaticMarkup = true;
   }

   markupCacheIsDropped() {
      return this.dropCacheForMarkup && this.dropCacheForOldMarkup;
   }

   storeCollectWords(filePath, collectWords) {
      const prettyPath = toSafePosix(filePath);
      this.currentStore.cachedFiles[prettyPath].words = collectWords;
   }

   getCachedWords() {
      let resultWords = [];
      for (const filePath of Object.keys(this.currentStore.cachedFiles)) {
         resultWords = [...resultWords, ...this.currentStore.cachedFiles[filePath].words];
      }
      return resultWords;
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
}

module.exports = Cache;
