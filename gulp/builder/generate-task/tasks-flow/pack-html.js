/**
 * @author Kolbeshin F.A.
 */
'use strict';

const { path } = require('../../../../lib/platform/path');
const gulp = require('gulp');
const logger = require('../../../../lib/logger').logger();

const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const pluginPackHtml = require('../../plugins/pack-html');
const packInlineScripts = require('../../plugins/pack-inline-scripts');
const { getTasksTypesByModules, fillEmptyTasksFlows } = require('../../../common/compiled-helpers');
const gulpIf = require('gulp-if');
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');
const getMetricsReporter = require('../../../common/classes/metrics-reporter');
const { moduleHasNoChanges } = require('../../../../lib/helpers');

function skipPackHtml(done) {
   done();
}

function generatePackHtml(taskParameters, depGraph, moduleInfo) {
   const moduleOutput = path.join(taskParameters.config.rawConfig.output, path.basename(moduleInfo.output));
   const input = path.join(moduleOutput, '/**/*.html');

   return function packHtml() {
      getMetricsReporter().markBuiltModule(moduleInfo);

      return gulp
         .src(input, { dot: false, nodir: true })
         .pipe(handlePipeException('packHtml', taskParameters, moduleInfo))
         .pipe(toPosixVinyl())
         .pipe(gulpIf(
            taskParameters.config.deprecatedStaticHtml,
            pluginPackHtml(taskParameters, moduleInfo, depGraph)
         ))
         .pipe(gulpIf(
            !taskParameters.config.inlineScripts,
            packInlineScripts(taskParameters, moduleInfo)
         ))
         .pipe(gulp.dest(moduleOutput));
   };
}

// статические html нужно анализировать и пересобирать пакеты только если меняется сама html-ка или меняется
// код, который может попасть в кастомный пакет у всего дерева зависимостей данного интерфейсного модуля.
function checkForChangesInHtml(taskParameters, moduleInfo) {
   if (moduleHasNoChanges(moduleInfo, [moduleInfo.htmlChanged])) {
      return [moduleInfo.name, ...moduleInfo.fullDependsTree].some((currentModuleName) => {
         const currentModuleInfo = taskParameters.config.getModuleInfoByName(currentModuleName);

         if (!currentModuleInfo) {
            logger.info(`Не смогли получить moduleInfo зависимости "${currentModuleInfo}" для модуля ${moduleInfo.name}`);
            return false;
         }

         return !moduleHasNoChanges(
            currentModuleInfo,
            [
               currentModuleInfo.localizationChanged || currentModuleInfo.dropLocalizationCache,
               currentModuleInfo.typescriptChanged || currentModuleInfo.jsChanged,
               currentModuleInfo.moduleDependenciesChanged
            ]
         );
      });
   }
   return true;
}

/**
 * Generation of the task for static html pages packing.
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * using by current running Gulp-task.
 * @returns {Undertaker.TaskFunction|function(done)} returns an empty function in case of un-appropriate flags to
 * avoid gulp unexpected completion with errors.
 */
function getPackHtmlTasksFLow(taskParameters, depGraph) {
   const skipTasks = [];
   const buildTasks = [];
   const modulesMeta = getTasksTypesByModules(
      taskParameters.config.modules,
      false,
      taskParameters.config.watcherRunning
   );

   modulesMeta.skip.forEach(() => {
      // нет смысла продуцировать тысячи дублей skip-задач, достаточно одной.
      if (skipTasks.length === 0) {
         skipTasks.push(skipPackHtml);
      }
   });

   modulesMeta.build.forEach((moduleInfo) => {
      const needToRunHtmlPacker = checkForChangesInHtml(taskParameters, moduleInfo);
      if (needToRunHtmlPacker) {
         buildTasks.push(generatePackHtml(taskParameters, depGraph, moduleInfo));
      } else if (skipTasks.length === 0) {
         skipTasks.push(skipPackHtml);
      }
   });

   return fillEmptyTasksFlows({ skipTasks, buildTasks });
}

module.exports = { getPackHtmlTasksFLow, skipPackHtml };
