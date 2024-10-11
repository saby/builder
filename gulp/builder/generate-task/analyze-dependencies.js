/**
 * Модуль, реализующий задачу проверки зависимостей (целостности) собираемого проекта.
 *
 * Критично! Задача должна запускаться строго после того как будут сохранены на диск следующие артефакты:
 * 1) %{ui-module}/.cache/components-info.json
 * 2) %{ui-module}/.cache/input-paths.json
 *
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');

const logger = require('../../../lib/logger').logger();

const { path } = require('../../../lib/platform/path');
const Analyzer = require('../../../lib/dependencies/analyzer');

function generateRunner(taskParameters) {
   const { config } = taskParameters;

   return async function analyzeProjectDependencies() {
      const stream = fs.createWriteStream(path.join(config.logFolder, 'deps-analysis.txt'), {
         encoding: 'utf-8'
      });

      try {
         const analyzer = new Analyzer(stream, config.modules);

         await analyzer.load(config.outputPath);

         await analyzer.testLostDependencies(config.outputPath);

         analyzer.testCycles();
      } catch (error) {
         // TODO: после обкатки включить вывод реальной ошибки
         logger.debug(`При анализе зависимостей произошла ошибка: ${error.message}\n${error.stack}`);
      } finally {
         stream.close();
      }
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
