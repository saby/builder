/**
 * Генерация задачи сохранения отчета об ошибках в json формате.
 * Нужно прежде всего для сотрудников отдела сборки,
 * чтобы оперативно реагировать на ошибки и предупреждения.
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../../lib/logger').logger();

/**
 * Генерация задачи сохранения отчета об ошибках в json формате.
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {function(): (Promise)}
 */
module.exports = function generateTaskForSaveLoggerReport(taskParameters) {
   if (!taskParameters.config.builderTests) {
      return function skipSaveReport(done) {
         done();
      };
   }

   return function saveReport(done) {
      /**
       * save logger report by this way only for builder unit tests.
       * In other cases save logger report before main gulp process exit
       * to catch all unexpected gulp tasks errors and store them into report
       */
      logger.saveLoggerReport(taskParameters.config.logFolder);

      /**
       * reset logger messages after it was saved in artifacts. Needed by builder
       * unit-test proper work
       */
      logger.reset();
      done();
   };
};
