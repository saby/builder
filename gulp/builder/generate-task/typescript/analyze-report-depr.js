'use strict';

const fs = require('fs-extra');
const logger = require('../../../../lib/logger').logger();
const { formatEntry } = require('../../../../lib/logger');
const CRITICAL_ERRORS = require('../../../../lib/typescript-critical-errors.json');
const TRUSTED_ERRORS = require('../../../../lib/typescript-trusted-errors.json');
const { path } = require('../../../../lib/platform/path');

const CRITICAL_TS_ERRORS = [
   'TS1005',
   'TS1068',
   'TS1135',
   'TS1136',
   'TS1002',
   'TS1003',
   'TS1128',
   'TS1144',
   'TS5023',
   'TS1110',
   'TS1127',
   'TS1137'
];

function analyzeReport(taskParameters, logFile) {
   return async function analyzeReportTask() {
      if (!taskParameters.config.typescriptChanged) {
         return;
      }
      const logFileContent = await fs.readFile(logFile, 'utf8');

      // TODO: Необходимо со всех сборок собрать реальные отчеты для анализа
      //    Убрать после закрытия задачи:
      //    https://online.sbis.ru/opendoc.html?guid=cfb68426-5ba9-4316-a851-abc4b7735477&client=3
      await fs.copy(logFile, path.join(path.dirname(logFile), 'builder_compilation_errors_full_original.log'));

      const tsErrors = logFileContent.split('\n')
         .filter(currentError => !!currentError)
         .map(currentError => currentError.replace(/\r/g, ''));

      if (tsErrors.length > 0) {
         const defaultLevel = taskParameters.config.isSbisPlugin ? 'debug' : 'info';
         let overallLevel = 'info';
         const logErrors = [];

         tsErrors.forEach((message) => {
            const moduleInfo = taskParameters.config.getModuleInfoByName(message);

            if (!moduleInfo) {
               logErrors.push(message);
            } else {
               logErrors.push(formatEntry({ message, moduleInfo }).message);

               /**
                * Don't log errors in Sbis Plugin because of issue with tsc configuration
                * TODO remove it after task completion
                * https://online.sbis.ru/opendoc.html?guid=77afe3f3-e22e-46ce-8355-6f73c135f2e9
                */
               let level = !taskParameters.config.isSbisPlugin &&
               CRITICAL_ERRORS.some(criticalMessage => message.startsWith(criticalMessage)) ? 'error' : defaultLevel;

               if (level === 'error') {
                  level = TRUSTED_ERRORS.some(trustedMessage => message.startsWith(trustedMessage)) ? defaultLevel : 'error';
               }

               // Don't pass any critical syntax errors
               if (CRITICAL_TS_ERRORS.some(errorCode => message.includes(`error ${errorCode}:`))) {
                  level = 'error';
               }

               if (level === 'error') {
                  // each ts error starts with the same error message pattern:
                  // MyModule/myFile.ts(line,column): error ....
                  // so we can extract fileName from it and mark it as failed in builder cache
                  // failed tsc check for some file marks whole interface module as FAILED,
                  // but at the same time don't mark the file as failed in "files-with-errors" cache.
                  // It causes unforeseen consequences in branch builds
                  const fileName = message.substr(0, message.indexOf('('));
                  taskParameters.cache.markFileAsFailed(fileName);
                  logger[level]({ message, moduleInfo });
                  overallLevel = 'error';
               }
            }
         });

         if (overallLevel === 'error') {
            logger[overallLevel]('TypeScript compilation was completed with errors. Check log records above for details.');
         } else {
            logger[defaultLevel](`TypeScript compilation was completed with errors. Check "${logFile}" for details.`);
         }

         await fs.outputFile(logFile, logErrors.join('\n'));
      } else {
         logger.info('TypeScript compilation was completed successfully!');
      }
   };
}

module.exports = analyzeReport;
