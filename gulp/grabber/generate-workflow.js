/**
 * Генерирует поток выполнения сбора локализуемых фраз
 * @author Kolbeshin F.A.
 */

'use strict';

// модули из npm
const { path } = require('../../lib/platform/path');
const gulp = require('gulp'),
   fs = require('fs-extra');

const handlePipeException = require('../common/plugins/handle-pipe-exception');
const guardSingleProcess = require('../common/generate-task/guard-single-process.js'),
   generateTaskForPrepareWS = require('../common/generate-task/prepare-ws'),
   generateTaskForGenerateJson = require('../common/generate-task/generate-json'),
   changedInPlace = require('../common/plugins/changed-in-place'),
   grabFile = require('./plugins/grab-file'),
   Configuration = require('./classes/configuration.js'),
   Cache = require('./classes/cache.js'),
   logger = require('../../lib/logger').logger(),
   TaskParameters = require('../common/classes/task-parameters');

const {
   generateTaskForInitWorkerPool,
   generateTaskForTerminatePool
} = require('../common/helpers');

const toPosixVinyl = require('../common/plugins/to-posix-vinyl');

/**
 * Генерирует поток выполнения сбора локализуемых фраз
 * @param {string[]} processArgv массив аргументов запуска утилиты
 * @returns {Undertaker.TaskFunction} gulp задача
 */
function generateWorkflow(processArgv) {
   // загрузка конфигурации должна быть синхронной, иначе не построятся задачи для сборки модулей
   const config = new Configuration();
   config.loadSync(processArgv); // eslint-disable-line no-sync

   const taskParameters = new TaskParameters(
      config,
      new Cache(config),
      true
   );

   if (!process.env['application-root']) {
      process.env['application-root'] = path.join(taskParameters.config.cachePath, 'platform');
   }

   return gulp.series(

      //  generateTaskForLock прежде всего
      guardSingleProcess.generateTaskForLock(taskParameters),
      generateTaskForLoadCache(taskParameters),

      // подготовка WS для воркера
      generateTaskForPrepareWS(taskParameters),
      generateTaskForInitWorkerPool(taskParameters),

      generateTaskForGenerateJson(taskParameters),
      generateTaskForGrabModules(taskParameters),
      gulp.parallel(

         // завершающие задачи
         generateTaskForSaveCache(taskParameters),
         generateTaskForSaveOutputJson(taskParameters),
         generateTaskForTerminatePool(taskParameters)
      ),

      // generateTaskForUnlock после всего
      guardSingleProcess.generateTaskForUnlock(taskParameters)
   );
}

function generateTaskForSaveCache(taskParameters) {
   return function saveCache() {
      return taskParameters.cache.save();
   };
}

function generateTaskForLoadCache(taskParameters) {
   return function loadCache() {
      return taskParameters.cache.load();
   };
}

function generateTaskForGrabSingleModule(taskParameters, moduleInfo) {
   const moduleInput = path.join(moduleInfo.path, '/**/*.@(js|xhtml|tmpl|wml|ts)');

   return function grabModule() {
      return gulp
         .src(moduleInput, { dot: false, nodir: true })
         .pipe(handlePipeException('grabModule', taskParameters, moduleInfo))
         .pipe(toPosixVinyl())
         .pipe(changedInPlace(taskParameters, moduleInfo))
         .pipe(grabFile(taskParameters, moduleInfo))
         .pipe(gulp.dest(moduleInfo.path));
   };
}

function generateTaskForGrabModules(taskParameters) {
   const tasks = [];
   let countCompletedModules = 0;

   const printPercentComplete = function(done) {
      countCompletedModules += 1;
      logger.progress((100 * countCompletedModules) / taskParameters.config.modules.length);
      done();
   };

   for (const moduleInfo of taskParameters.config.modules) {
      tasks.push(
         gulp.series(
            generateTaskForGrabSingleModule(taskParameters, moduleInfo),
            printPercentComplete
         )
      );
   }
   return gulp.parallel(tasks);
}

function generateTaskForSaveOutputJson(taskParameters) {
   return async function saveOutputJson() {
      await fs.writeJSON(taskParameters.config.outputPath, taskParameters.cache.getCachedWords(), { spaces: 1 });
   };
}

module.exports = generateWorkflow;
