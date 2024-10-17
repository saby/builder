/**
 * Модуль, реализующий задачу проверки зависимостей (целостности) собираемого проекта.
 *
 * Критично! Задача должна запускаться строго после того как будут сохранены на диск следующие артефакты:
 * 1) %{ui-module}/.cache/components-info.json
 * 2) %{ui-module}/.cache/input-paths.json
 * 3) %{ui-module}/.cache/dependencies.json
 *
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');

const execInPool = require('../../common/exec-in-pool');

const logger = require('../../../lib/logger').logger();

function generateRunner(taskParameters) {
   const { config } = taskParameters;

   // TODO: Не самое удачное место для кода, который относится только к unit тестам.
   //    Необходимо в целом избавиться от этого флага.
   if (process.env['builder-tests']) {
      return function skipAnalyzeProjectDependencies(done) {
         done();
      };
   }

   return async function analyzeProjectDependencies() {
      const [error, diagnosticMessages] = await execInPool(
         taskParameters.pool,
         'analyzeProjectDependencies',
         [
            config.modules,
            config.externalModules,
            config.logFolder,
            config.outputPath
         ]
      );

      if (error) {
         // TODO: после обкатки включить вывод реальной ошибки
         logger.debug(`При анализе зависимостей произошла ошибка: ${error.message}\n${error.stack}`);

         return;
      }

      diagnosticMessages.forEach(chunk => logger[chunk.kind]({
         message: chunk.message,
         moduleInfo: config.getModuleInfoByName(chunk.module)
      }));
   };
}

function genTaskForAnalyzeDependencies(taskParameters) {
   const timer = taskParameters.metrics.createTimer('analyze dependencies');

   return gulp.series(
      timer.start(),
      generateRunner(taskParameters),
      timer.finish()
   );
}

module.exports = genTaskForAnalyzeDependencies;
