/**
 * Генерация задачи для подготовки WS к исполнению в builder'е.
 * Из-за того, что часть кода написана на ES5 (AMD модули), а другая часть на ES6 и TypeScript,
 * нужно привести к одному знаменателю.
 * @author Kolbeshin F.A.
 */

'use strict';

const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const { path } = require('../../../lib/platform/path');
const gulp = require('gulp'),
   gulpChmod = require('gulp-chmod'),
   pluginCompileEsAndTs = require('../../builder/plugins/compile-es-and-ts-simple'),
   gulpIf = require('gulp-if'),
   filterCached = require('../../../gulp/builder/plugins/filter-cached'),
   changedInPlace = require('../../common/plugins/changed-in-place'),
   TaskParameters = require('../../common/classes/task-parameters'),
   compileJsonToJs = require('../../builder/plugins/compile-json-js'),
   logger = require('../../../lib/logger').logger(),
   { generateReadModuleCache } = require('../../builder/classes/modules-cache'),
   { getModuleInputForPrepareWS } = require('../../../lib/changed-files/get-module-input'),
   {
      generateTaskForSymlinkCompiled,
      getTasksTypesByModules,
      getParallelTasksOrderByQueue
   } = require('../compiled-helpers');

const toPosixVinyl = require('../plugins/to-posix-vinyl');

function needSymlink() {
   return (file) => {
      if (file.useSymlink) {
         // if it's a file from compiled sources to be symlink to, rebase it to
         // compiled sources directory, otherwise symlink it "as is"
         if (file.origin) {
            file.pHistory = [file.origin];
            file.base = file.compiledBase;
         }
         return true;
      }
      return false;
   };
}

// TODO: Используется только в задаче сборка локализации и в тестах.
//  Перенести в тестовую директорию модуль целиком.
//  https://online.sbis.ru/opendoc.html?guid=823d4c9f-cc90-479d-8bda-492e4468800f&client=3
/**
 * Генерация задачи инкрементальной сборки модулей.
 * @param {TaskParameters} taskParameters параметры задачи
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForPrepareWS(taskParameters, currentModuleInfo, needToBePrepared) {
   if (!taskParameters.config.initCore || (currentModuleInfo && !needToBePrepared)) {
      return function skipPrepareWS(done) {
         done();
      };
   }

   const localTaskParameters = new TaskParameters(taskParameters.config, taskParameters.cache, false);
   localTaskParameters.timings = taskParameters.timings;
   let requiredModules = currentModuleInfo ? [currentModuleInfo] : taskParameters.config.modules;
   requiredModules = requiredModules.filter(moduleInfo => moduleInfo.required);
   const buildWSModule = taskParameters.metrics.createTimer('buildWSModule');
   if (requiredModules.length) {
      const symlinkTasks = [];
      const buildTasks = [];
      const moduleOutputRoot = process.env['application-root'] || path.join(localTaskParameters.config.cachePath, 'platform');
      const modulesMeta = getTasksTypesByModules(requiredModules, true);

      modulesMeta.symlink.forEach((moduleInfo) => {
         const moduleOutput = path.join(moduleOutputRoot, moduleInfo.outputName);
         symlinkTasks.push(
            generateTaskForSymlinkCompiled(taskParameters, moduleInfo, moduleOutput)
         );
      });
      modulesMeta.build.forEach((moduleInfo) => {
         buildTasks.push(
            generateTaskForPrepareWSModule(localTaskParameters, moduleInfo, moduleOutputRoot)
         );
      });
      return gulp.series(
         buildWSModule.start(),
         getParallelTasksOrderByQueue(symlinkTasks, buildTasks),
         buildWSModule.finish()
      );
   }
   return function skipPrepareWS(done) {
      done();
   };
}

function generateTaskForPrepareWSModule(localTaskParameters, moduleInfo, moduleOutputRoot) {
   function buildWSModule() {
      const gulpSrcOptions = { dot: false, nodir: true };
      const moduleInput = getModuleInputForPrepareWS(localTaskParameters, moduleInfo, gulpSrcOptions);
      const moduleOutput = path.join(moduleOutputRoot, moduleInfo.name);
      logger.debug(`Задача buildWSModule. moduleInput: "${JSON.stringify(moduleInput)}", moduleOutput: "${moduleOutput}"`);

      return gulp
         .src(moduleInput, gulpSrcOptions)
         .pipe(handlePipeException('buildWSModule', localTaskParameters, moduleInfo))
         .pipe(toPosixVinyl())

         // builder unit tests dont have cache
         .pipe(
            gulpIf(
               !!localTaskParameters.cache && !localTaskParameters.config.skipChangedFiles,
               changedInPlace(localTaskParameters, moduleInfo)
            )
         )
         .pipe(pluginCompileEsAndTs(localTaskParameters, moduleInfo))
         .pipe(compileJsonToJs(localTaskParameters, moduleInfo))
         .pipe(filterCached(localTaskParameters, moduleInfo))
         .pipe(gulpChmod({ read: true, write: true }))
         .pipe(gulpIf(needSymlink(), gulp.symlink(moduleOutput), gulp.dest(moduleOutput)));
   }

   function cleanWSModuleCache(done) {
      delete moduleInfo.cache;
      done();
   }

   return gulp.series(
      generateReadModuleCache(localTaskParameters, moduleInfo),
      buildWSModule,
      cleanWSModuleCache
   );
}

module.exports = generateTaskForPrepareWS;
