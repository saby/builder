/**
 * Генерация задачи генерации json описания компонентов для локализации
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra');
const assert = require('assert');

const logger = require('../../../lib/logger').logger();
const hooks = require('../classes/hooks').hooks();
const getBuildStatusStorage = require('../../common/classes/build-status');
const getMetricsReporter = require('../../common/classes/metrics-reporter');
const filterComponentProperties = require('../../../lib/components-properties');

/**
 * Получить путь до файла с кешем.
 * @param {string} rootDir Корневая директория
 * @returns {string}
 */
function getCacheFilePath(rootDir) {
   return path.join(rootDir, 'json-generator-cache.json');
}

/**
 * Получить путь до файла-артефакта.
 * @param {string} rootDir Корневая директория
 * @returns {string}
 */
function getArtifactFilePath(rootDir) {
   return path.join(rootDir, 'components-properties.json');
}

/**
 * Проверить, нужно ли обрабатывать модуль.
 * @param {ModuleInfo} moduleInfo Интерфейсный модуль
 * @returns {boolean}
 */
function shouldProcessModule(moduleInfo) {
   if (getBuildStatusStorage().cacheIsDropped || moduleInfo.forceRebuild) {
      // В случаях, когда кеш сброшен или запрошена пересборка модуля, модуль обрабатываем
      return true;
   }

   if (Array.isArray(moduleInfo.changedFiles) && Array.isArray(moduleInfo.deletedFiles)) {
      // Если в списке измененных файлов есть файлы с требуемым расширением,
      // то собираем tailwind.css для данного модуля.
      const isTargetFilePredicate = filePath => filePath.endsWith('.js') && !filePath.endsWith('.min.js');

      return !(
         moduleInfo.changedFiles.some(isTargetFilePredicate) || moduleInfo.deletedFiles.some(isTargetFilePredicate)
      );
   }

   // Во всех остальных случаях обрабатываем модуль без оптимизаций
   return true;
}

/**
 * Получить набор директорий UI модулей, для которых необходимо выполнить
 * сбор данных о свойствах компонентов.
 * @param {TaskParameters} taskParameters
 * @returns {string[]}
 */
function getInputDirectories(taskParameters) {
   const inputDirs = [];

   for (const module of taskParameters.config.modules) {
      if (shouldProcessModule(module)) {
         inputDirs.push(module.path);
      }
   }

   return inputDirs;
}

/**
 * Переместить файл кеша из директории скомпилированных ресурсов.
 * Метод актуален для сборки локальных стендов, в дистрибутиве которого
 * файл кеша располагается в директории скомпилированных ресурсов.
 * @param {TaskParameters} taskParameters
 * @returns {Promise<void>}
 */
async function moveCacheFromCompiled(taskParameters) {
   if (!taskParameters.config.additionalCachePath) {
      return;
   }

   if (await fs.pathExists(getCacheFilePath(taskParameters.config.additionalCachePath))) {
      const generatorCachePath = getCacheFilePath(taskParameters.config.cachePath);

      if (!(await fs.pathExists(generatorCachePath))) {
         await fs.copy(getCacheFilePath(taskParameters.config.additionalCachePath), generatorCachePath);
      }
   }
}

/**
 * Загрузить артефакт продыдущей сборки из кеша.
 * @param {TaskParameters} taskParameters
 * @returns {Promise<Object>}
 */
async function loadCachedComponentProperties(taskParameters) {
   let cachedData = { };

   const filePath = getArtifactFilePath(taskParameters.config.cachePath);

   if (!(await fs.pathExists(filePath))) {
      return cachedData;
   }

   try {
      cachedData = await fs.readJSON(filePath);
   } catch (err) {
      logger.warning({
         message: 'Не удалось прочитать файл кеша',
         filePath,
         error: err
      });
   }

   return cachedData;
}

/**
 * Проверить, изменились ли данные о свойствах компонентов.
 * @param {Object} cachedComponentProperties Данные предыдущей сборки.
 * @param {Object} componentProperties Данные текущей сборки.
 * @returns {boolean}
 */
function hasChangedComponentProperties(cachedComponentProperties, componentProperties) {
   try {
      assert.deepStrictEqual(cachedComponentProperties, componentProperties);

      return false;
   } catch (error) {
      return true;
   }
}

/**
 * Сбросить кеш верстки.
 * @param taskParameters
 * @returns {Promise<void>}
 */
async function dropMarkupCache(taskParameters) {
   if (!getBuildStatusStorage().cacheIsDropped && !taskParameters.cache.markupCacheIsDropped()) {
      const reason = 'Мета-данные components-properties изменились. Кеш всех шаблонов будет сброшен.';

      logger.info(reason);

      getMetricsReporter().onCacheDrop('templates', reason);

      await hooks.executeHook('dropCacheHook', ['templates', reason]);
   }

   taskParameters.cache.setDropCacheForMarkup();
   taskParameters.cache.setDropCacheForOldMarkup();
   taskParameters.cache.setDropCacheForStaticMarkup();
}

/**
 * Генерация задачи генерации json описания компонентов для локализации
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @return {function} функция-задача для gulp
 */
function generateTaskForGenerateJson(taskParameters) {
   if (!taskParameters.needGenerateJson) {
      return function skipGenerateJson(done) {
         done();
      };
   }

   return async function generateJson() {
      const startTime = Date.now();

      try {
         const inputDirs = getInputDirectories(taskParameters);

         if (inputDirs.length === 0) {
            taskParameters.metrics.storeTaskTime('generate components-properties.json', startTime);

            logger.debug('js-код не менялся, пересборка components-properties будет пропущена');

            return;
         }

         await moveCacheFromCompiled(taskParameters);

         // eslint-disable-next-line global-require
         const runJsonGenerator = require('../../../lib/i18n/run-json-generator');

         const resultJsonGenerator = await runJsonGenerator(inputDirs, taskParameters.config.cachePath);

         for (const error of resultJsonGenerator.errors) {
            logger.warning({
               message: 'Ошибка при разборе JSDoc комментариев',
               filePath: error.filePath,
               error: error.error
            });
         }

         const componentProperties = filterComponentProperties(resultJsonGenerator.index);

         // если components-properties поменялись, то нужно сбросить кеш для верстки
         if (hasChangedComponentProperties(await loadCachedComponentProperties(taskParameters), componentProperties)) {
            await dropMarkupCache(taskParameters);
         }

         await fs.writeJSON(getArtifactFilePath(taskParameters.config.cachePath), componentProperties, { spaces: 1 });
      } catch (error) {
         logger.error({
            message: "Builder's error in 'generateJson' task",
            error
         });
      }

      taskParameters.metrics.storeTaskTime('generate components-properties.json', startTime);
   };
}

module.exports = generateTaskForGenerateJson;
