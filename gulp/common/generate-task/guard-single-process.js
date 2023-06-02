/**
 * Генерация задач для предотвращения множественного запуска builder'а на одном кеше.
 * Необходимо для предсказуемого результата.
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../../lib/logger').logger();
const { lockBuildInfo, unlockBuildInfo } = require('../classes/build-info');

/**
 * Геренация задачи блокировки. Обязательно должна выполнятся перед всеми другими задачами.
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {function(): (Promise)}
 */
function generateTaskForLock(taskParameters) {
   const { cachePath } = taskParameters.config;

   return function lock() {
      return new Promise((resolve) => {
         lockBuildInfo(cachePath, () => {
            taskParameters.cache.previousRunFailed = true;
         });

         // задаём в логгере информацию о приложении и ответственном
         logger.setBaseInfo(taskParameters.config.cloud, taskParameters.config.responsibleOfCloud);

         resolve();
      });
   };
}

/**
 * Геренация задачи разблокировки. Обязательно должна выполнятся после всех других задач.
 * @returns {function(): (Promise)}
 */
function generateTaskForUnlock(taskParameters) {
   const { cachePath } = taskParameters.config;

   return function unlock() {
      return new Promise((resolve, reject) => {
         try {
            unlockBuildInfo(cachePath);
         } catch (error) {
            logger.error(error.message);

            return reject(error);
         }

         return resolve();
      });
   };
}

module.exports = {
   generateTaskForLock,
   generateTaskForUnlock
};
