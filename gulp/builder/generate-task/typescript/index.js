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

   function getTscTasksList() {
      const tscTasks = [];
      let excludeModulesLists = [[]];

      // В проекте online-inside на сегодняшний день более 1300 интерфейсных модулей и в результате
      // бесконтрольного роста объёма интерфейсного кода(особенно после появления модулей метатипов)
      // мы упёрлись в потолок по работе с tsc компилятором, он падает с Javascript Heap out of memory
      // и ни один из методов решения проблемы и сборки единого проекта не помогает, исходного кода так
      // много, что даже полное отключение тайпчекинга не спасает от переполнения памяти. Было принято решение
      // дробить проект online-inside на 2 части и собирать 2 куска последовательно, но чтобы это делать, нужно
      // прежде всего научиться сортировать список наших интерфейсных модулей согласно из зависимости друг от друга.
      // Эту проблему уже решили на стороне jinnee - они используют метод топологической сортировки на графах,
      // чтобы решить проблему сильной связности проекта online-inside.
      // Согласно локальным замерам на дистрибутиве online-ru, последовательный запуск 2 вышеописанных кусков
      // проекта выполняется почти в 2 раза быстрее, чем целиковая сборка - 13 минут против 24-25 минут
      // (это сборка с нуля), и по памяти мы съедаем порядка 13.5 Гб памяти, что также демонстрирует, что tsc
      // лучше и быстрее работает, если он не упирается в потолок по потреблению памяти.
      if (taskParameters.config.isOnlineInside) {
         excludeModulesLists = [
            taskParameters.config.modules.slice(
               taskParameters.config.modules.length / 2,
               taskParameters.config.modules.length / 2 + taskParameters.config.modules.length / 4
            ).map(moduleInfo => moduleInfo.name),
            taskParameters.config.modules.slice(
               taskParameters.config.modules.length / 2 + taskParameters.config.modules.length / 4,
               taskParameters.config.modules.length
            ).map(moduleInfo => moduleInfo.name)
         ];
      }

      excludeModulesLists.forEach((excludeModulesList) => {
         const logFile = getLogFilePath(taskParameters, output);
         tscTasks.push(
            gulp.series(
               workspace.prepare(taskParameters, excludeModulesList),
               generateProcessFilesWithES5Ext(taskParameters),
               compile(taskParameters, logFile),
               workspace.clean(taskParameters),
               analyzeReport(taskParameters, logFile)
            )
         );
      });

      return tscTasks;
   }

   return gulp.series(
      runTypescriptCompiler.start(),
      gulp.series(getTscTasksList()),
      runTypescriptCompiler.finish()
   );
}

module.exports = generateTaskForTypescript;
