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
   const shouldSkipAnalyze = (
      process.env['builder-tests'] ||
      taskParameters.config.ESVersion === 5
   );

   if (shouldSkipAnalyze) {
      return function skipAnalyzeProjectDependencies(done) {
         done();
      };
   }

   return async function analyzeProjectDependencies() {
      // убираем зависимость Controls от Controls-default-theme, которую мы сами вначале и создали исключительно
      // для правильной записи в link_dependencies. Это нужно, пока живёт IE, потом эту зависимость можно будет
      // убрать. А отсюда удаляем, чтобы анализатор не ругался на якобы цикл между s3mod'ами
      const ControlsModuleInfo = taskParameters.config.getModuleInfoByName('Controls');
      if (ControlsModuleInfo) {
         ControlsModuleInfo.depends = ControlsModuleInfo.depends.filter(dep => dep !== 'Controls-default-theme');
      }
      const [error, diagnosticMessages] = await execInPool(
         taskParameters.pool,
         'analyzeProjectDependencies',
         [
            config.modules,
            config.externalModules,
            config.logFolder,
            config.outputPath,

            // Пока что проверяем в тестах по веткам и локально.
            // Если проверка покажет свою эффективность,
            // то будем думать, как раскатать на всех.
            (
               taskParameters.config.cloud === '' ||
               taskParameters.config.cloud === 'InTest'
            )
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
