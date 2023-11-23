'use strict';

const gulp = require('gulp');
const workspace = require('./workspace');
const compile = require('./compile');
const analyzeReport = require('./analyze-report');
const { path, cwd } = require('../../../../lib/platform/path');
const { processFilesWithES5Extension } = require('../../../../lib/helpers');

function getLogFilePath(taskParameters, output) {
   const logFolder = taskParameters.config.logFolder || cwd();
   return output || path.join(logFolder, 'builder_compilation_errors.log');
}

// При сборке в ES5 спецификации надо заменить .ts на .ts.es5 файлы из-за
// несовместимости кода Deferred в ES5 и ES6 спецификациях.
// В ES6 спецификации в конструкторе требуется вызов super, что в ES5
// спецификации превращается в невалидный код, а в случае с Deferred переписать
// код на наследование не получится, поскольку это дженерик и мы сломаем типы
// https://github.com/microsoft/TypeScript/issues/15202.
// Решением данной проблемы пока стало наличие 2 версий файла - .ts по дефолту
// и .ts.es5 для сборки при ESVersion = 5
function generateProcessFilesWithES5Ext(taskParameters) {
   if (taskParameters.config.ESVersion === 5) {
      return function processFilesWithES5Ext() {
         return processFilesWithES5Extension(taskParameters.config.sourcesDirectory);
      };
   }

   return function skipProcessES5ExtFiles(done) {
      done();
   };
}

function generateTaskForTypescript(taskParameters, output) {
   if (taskParameters.config.watcherRunning) {
      return function skipTypescript(done) {
         done();
      };
   }

   if (!taskParameters.config.emitTypescript) {
      return generateProcessFilesWithES5Ext(taskParameters);
   }

   const runTypescriptCompiler = taskParameters.metrics.createTimer('emit typescript');
   const logFile = getLogFilePath(taskParameters, output);

   return gulp.series(
      runTypescriptCompiler.start(),
      workspace.prepare(taskParameters),
      generateProcessFilesWithES5Ext(taskParameters),
      compile(taskParameters, logFile),
      analyzeReport(taskParameters, logFile),
      workspace.clean(taskParameters),
      runTypescriptCompiler.finish()
   );
}

module.exports = generateTaskForTypescript;
