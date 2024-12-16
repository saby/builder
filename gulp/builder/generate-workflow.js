/**
 * Generates a workflow for build of current project static files.
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const gulp = require('gulp');

const generateTaskForDependantBuild = require('./generate-task/dependant-build'),
   generateTaskForStaticTmplJson = require('./generate-task/static-template-json'),
   generateTaskForBuildModules = require('./generate-task/build-modules'),
   { generateTaskForMarkThemeModules } = require('./generate-task/mark-theme-modules'),
   generateTaskForCopyResources = require('./generate-task/copy-resources'),
   generateTaskForCompress = require('./generate-task/compress'),
   generateTaskForPackHtml = require('./generate-task/pack-html'),
   generateTaskForCustomPack = require('./generate-task/custom-packer'),
   generateTaskForBuildFonts = require('./generate-task/generate-fonts'),
   genTaskForAnalyzeDependencies = require('./generate-task/analyze-dependencies'),
   generateTaskForUpdateTscReport = require('./generate-task/update-tsc-report'),
   {
      genTaskForCleanOutdatedFiles,
      genTaskForCleanDeletedFiles
   } = require('./generate-task/remove-outdated-files'),
   generateTaskForGenerateJson = require('../common/generate-task/generate-json'),
   guardSingleProcess = require('../common/generate-task/guard-single-process.js'),
   generateTaskForInterfacePacking = require('./generate-task/pack-interfaces'),
   generateTaskForSaveJoinedMeta = require('../common/generate-task/save-joined-meta'),
   { checkModuleDependenciesExisting } = require('../../lib/check-module-dependencies'),
   generateTaskForSaveLoggerReport = require('../common/generate-task/save-logger-report'),
   generateTaskForSaveMetaFiles = require('../builder/generate-task/save-meta-files'),
   Cache = require('./classes/cache'),
   Configuration = require('./classes/configuration.js'),
   TaskParameters = require('../common/classes/task-parameters'),
   pushChanges = require('../../lib/push-changes'),
   generateTaskForTypescript = require('./generate-task/typescript'),
   generateTaskForBuildTailwindCss = require('./generate-task/build-tailwindcss'),
   generateTaskProcessStableModules = require('./generate-task/process-modules');

const {
   generateTaskForLoadCache,
   generateTaskForSaveCache,
   generateTaskForInitWorkerPool,
   generateTaskForTerminatePool,
   generateTaskForGetJoinedMeta
} = require('../common/helpers');

const buildStatus = require('../common/classes/build-status')();
const getMetricsReporter = require('../common/classes/metrics-reporter');

/**
 * Generates a workflow for build of current project static files.
 * @param {string[]} processArgv array of an arguments of running of builder
 * @param {object?} watcherChangedFiles Collection of changes received from watcher.
 * @returns {Undertaker.TaskFunction} gulp task
 */
function generateWorkflow(processArgv, watcherChangedFiles) {
   // configuration loading should be synchronous, otherwise tasks queue of current build will not be built
   const config = new Configuration();
   config.loadSync(processArgv, watcherChangedFiles);

   const taskParameters = new TaskParameters(
      config,
      new Cache(config),
      config.localizations.length > 0 && config.isReleaseMode
   );

   if (config.projectWithoutChangesInFiles) {
      return gulp.series(
         guardSingleProcess.generateTaskForLock(taskParameters),
         generateTaskForSaveJoinedMeta(taskParameters),
         generateTaskForUpdateStatus(),
         guardSingleProcess.generateTaskForUnlock(taskParameters)
      );
   }

   if (taskParameters.config.watcherRunning) {
      // Запустить легкую пересборку по изменениям, которые предоставил gulp.watcher

      return gulp.series(
         guardSingleProcess.generateTaskForLock(taskParameters),
         generateTaskForLoadCache(taskParameters),
         generateTaskForCheckVersion(taskParameters),
         genTaskForCleanDeletedFiles(taskParameters),
         generateTaskForMarkThemeModules(taskParameters),
         generateTaskForInitWorkerPool(taskParameters, config.outputPath),
         generateTaskForBuildTailwindCss(taskParameters),
         generateTaskForBuildModules(taskParameters),
         generateTaskForSaveCache(taskParameters, true),
         generateTaskForPushOfChanges(taskParameters),
         generateTaskForTerminatePool(taskParameters),
         guardSingleProcess.generateTaskForUnlock(taskParameters)
      );
   }

   return gulp.series(

      // generateTaskForLock's first of all
      guardSingleProcess.generateTaskForLock(taskParameters),
      generateTaskForLoadCache(taskParameters),
      generateTaskForInitWorkerPool(taskParameters, config.outputPath),
      generateTaskProcessStableModules(taskParameters),

      // generateTaskForClearCache needs loaded cache
      generateTaskForClearCache(taskParameters),
      genTaskForCleanDeletedFiles(taskParameters),
      generateTaskForTypescript(taskParameters),

      generateTaskForMarkThemeModules(taskParameters),
      generateTaskForGenerateJson(taskParameters),

      generateTaskForBuildTailwindCss(taskParameters),
      generateTaskForBuildModules(taskParameters),
      generateTaskForGetJoinedMeta(taskParameters),
      generateTaskForInterfacePacking(taskParameters),
      genTaskForCleanOutdatedFiles(taskParameters),
      generateTaskForCustomPack(taskParameters),

      // данные о contents и содержание в нём фич и провайдеров изменилось уже
      // после инициализации пулла воркеров, соответственно перед сборкой html.tmpl
      // шаблонов нам необходимо переинициализировать пулл воркеров, чтобы
      // актуализировать contents и передать его в воркеры
      generateTaskForTerminatePool(taskParameters),
      generateTaskForInitWorkerPool(taskParameters, config.outputPath),
      generateTaskForDependantBuild(taskParameters),
      generateTaskForBuildFonts(taskParameters),
      generateTaskForStaticTmplJson(taskParameters),
      generateTaskForSaveCache(taskParameters),
      generateTaskForSaveMetaFiles(taskParameters),
      generateTaskForCopyResources(taskParameters),
      genTaskForAnalyzeDependencies(taskParameters),
      generateTaskForUpdateTscReport(taskParameters),
      generateTaskForCheckModuleDeps(taskParameters),
      generateTaskForPackHtml(taskParameters),
      generateTaskForCompress(taskParameters),
      generateTaskForSaveJoinedMeta(taskParameters),
      generateTaskForTerminatePool(taskParameters),
      generateTaskForSaveLoggerReport(taskParameters),
      generateTaskForSaveTimeReport(taskParameters),
      generateTaskForUpdateStatus(),
      generateTaskForTimeMetrics(taskParameters),
      generateTaskForPushOfChanges(taskParameters),

      // generateTaskForUnlock's after all
      guardSingleProcess.generateTaskForUnlock(taskParameters)
   );
}

function generateTaskForCheckVersion(taskParameters) {
   return function checkBuilderVersion(done) {
      const lastVersion = taskParameters.cache.lastStore.versionOfBuilder,
         currentVersion = taskParameters.cache.currentStore.versionOfBuilder;
      if (lastVersion !== currentVersion) {
         // eslint-disable-next-line no-console
         console.error(
            `Текущая версия Builder'а (${currentVersion}) не совпадает с версией, ` +
            `сохранённой в кеше (${lastVersion}). ` +
            'Вероятно, необходимо передеплоить стенд.'
         );
      }
      done();
   };
}

function generateTaskForPushOfChanges(taskParameters) {
   if (!taskParameters.config.staticServer) {
      return function skipPushOfChangedFiles(done) {
         done();
      };
   }

   return function pushOfChangedFiles() {
      return pushChanges(taskParameters);
   };
}

function generateTaskForSaveTimeReport(taskParameters) {
   return async function saveTimeReport() {
      const reportJson = taskParameters.metrics.getTimeReport();

      // eslint-disable-next-line no-console
      console.table(reportJson);
      await fs.outputJson(`${taskParameters.config.cachePath}/time-report.json`, reportJson);
   };
}

function generateTaskForTimeMetrics(taskParameters) {
   return async function saveTimeMetrics() {
      const metricsJson = taskParameters.metrics.getTimeMetrics(taskParameters);

      getMetricsReporter().setTimings(metricsJson.metrics);

      await fs.outputJson(`${taskParameters.config.cachePath}/time-metrics.json`, metricsJson);
   };
}

function generateTaskForClearCache(taskParameters) {
   return async function clearCache() {
      const startTime = Date.now();

      await taskParameters.cache.clearCacheIfNeeded();

      taskParameters.metrics.storeTaskTime('clearCache', startTime);
   };
}

function generateTaskForCheckModuleDeps(taskParameters) {
   if (!taskParameters.config.checkModuleDependencies) {
      return function skipCheckModuleDepsExisting(done) {
         done();
      };
   }

   return async function checkModuleDepsExisting() {
      const startTime = Date.now();

      await checkModuleDependenciesExisting(taskParameters);

      taskParameters.metrics.storeTaskTime('module dependencies checker', startTime);
   };
}

function generateTaskForUpdateStatus() {
   return function updateBuildStatus(done) {
      buildStatus.closePendingModules();

      done();
   };
}

module.exports = generateWorkflow;
