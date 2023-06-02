/**
 * Генерация задачи генерации json описания компонентов для локализации
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra'),
   assert = require('assert');

const logger = require('../../../lib/logger').logger();
const hooks = require('../classes/hooks').hooks();
const getBuildStatusStorage = require('../../common/classes/build-status');
const filterComponentProperties = require('../../../lib/components-properties');

/**
 * prepares json-generator-cache to ve used further in generateJson task.
 * Could be useful to get corresponding result of a build rapidly faster than
 * the one without any prepared json generator cache
 * @param root
 * @param currentCachePath
 * @param additionalCachePath
 * @returns {Promise<void>}
 */
async function prepareJsonGeneratorCache(root, currentCachePath, additionalCachePath) {
   const generatorCachePath = path.join(currentCachePath, 'json-generator-cache.json');
   if (!(await fs.pathExists(generatorCachePath))) {
      await fs.copy(path.join(additionalCachePath, 'json-generator-cache.json'), generatorCachePath);
   }
}

/**
 * Генерация задачи генерации json описания компонентов для локализации
 * @param {TaskParameters} taskParameters параметры для задач
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
         const folders = [];
         for (const module of taskParameters.config.modules) {
            folders.push(module.path);
         }

         // если локализация не нужна, то и ругаться, что json-generator нет, не нужно.
         // eslint-disable-next-line global-require
         const runJsonGenerator = require('../../../lib/i18n/run-json-generator');
         if (
            taskParameters.config.additionalCachePath &&
            await fs.pathExists(path.join(taskParameters.config.additionalCachePath, 'json-generator-cache.json'))
         ) {
            await prepareJsonGeneratorCache(
               taskParameters.config.sourcesDirectory,
               taskParameters.config.cachePath,
               taskParameters.config.additionalCachePath
            );
         }
         const resultJsonGenerator = await runJsonGenerator(folders, taskParameters.config.cachePath);
         for (const error of resultJsonGenerator.errors) {
            logger.warning({
               message: 'Ошибка при разборе JSDoc комментариев',
               filePath: error.filePath,
               error: error.error
            });
         }

         const componentProperties = filterComponentProperties(resultJsonGenerator.index);

         // если components-properties поменялись, то нужно сбросить кеш для верстки
         let isComponentsPropertiesChanged = false;
         const filePath = path.join(taskParameters.config.cachePath, 'components-properties.json');
         if (await fs.pathExists(filePath)) {
            let oldIndex = {};
            try {
               oldIndex = await fs.readJSON(filePath);
            } catch (err) {
               logger.warning({
                  message: 'Не удалось прочитать файл кеша',
                  filePath,
                  error: err
               });
            }

            try {
               assert.deepStrictEqual(oldIndex, componentProperties);
            } catch (error) {
               isComponentsPropertiesChanged = true;
            }
         } else {
            isComponentsPropertiesChanged = true;
         }

         if (isComponentsPropertiesChanged) {
            if (
               !getBuildStatusStorage().cacheIsDropped &&
               !taskParameters.cache.markupCacheIsDropped()
            ) {
               const reason = 'Мета-данные components-properties изменились. Кеш всех шаблонов будет сброшен.';
               logger.info(reason);
               await hooks.executeHook('dropCacheHook', ['templates', reason]);
            }
            taskParameters.cache.setDropCacheForMarkup();
            taskParameters.cache.setDropCacheForOldMarkup();
            taskParameters.cache.setDropCacheForStaticMarkup();
         }
         await fs.writeJSON(filePath, componentProperties, { spaces: 1 });
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
