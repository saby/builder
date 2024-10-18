/**
 * Генерация задачи инкрементальной сборки шаблонов *.html.tmpl.
 * @author Kolbeshin F.A.
 */

'use strict';

const { getBuildHtmlTasksFlow, skipBuildHtmlTmpl } = require('./tasks-flow/build-html-tmpl');
const { getParallelTasksOrderByQueue } = require('../../common/compiled-helpers');

function generateTaskForBuildHtmlTmpl(taskParameters) {
   const { config } = taskParameters;

   if (!config.htmlWml) {
      return skipBuildHtmlTmpl;
   }

   const { buildTasks, skipTasks } = getBuildHtmlTasksFlow(taskParameters, config.modules);

   if (buildTasks.length === 0) {
      return skipBuildHtmlTmpl;
   }

   return getParallelTasksOrderByQueue(skipTasks, buildTasks);
}

module.exports = generateTaskForBuildHtmlTmpl;
