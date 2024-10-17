/**
 * @author Kolbeshin F.A.
 */

'use strict';
const gulp = require('gulp');
const DepGraph = require('../../../packer/lib/dependency-graph');
const { getParallelTasksOrderByQueue } = require('../../common/compiled-helpers');
const { getPackHtmlTasksFLow, skipPackHtml } = require('./tasks-flow/pack-html');
const pMap = require('p-map');
const path = require('path');
const fs = require('fs-extra');

async function storeMeta(metaPath, objectToStore) {
   let currentMeta;
   if (await fs.pathExists(metaPath)) {
      currentMeta = await fs.readJson(metaPath);
   } else {
      currentMeta = [];
   }

   // static_packages generates for each found html every time, so we need to remove old packages
   // from versioned meta.
   currentMeta = currentMeta.filter(currentFile => !currentFile.includes('/static_packages/'));

   currentMeta = [...currentMeta, ...objectToStore];

   await fs.outputJson(metaPath, currentMeta);
}

function generateStoreMetaTask(taskParameters) {
   if (taskParameters.config.version) {
      return async function storeAdditionalMeta() {
         await pMap(
            Object.keys(taskParameters.versionedModules),
            async(currentModule) => {
               await storeMeta(
                  path.join(
                     taskParameters.config.rawConfig.output,
                     currentModule,
                     '.builder/versioned_modules.json'
                  ),
                  taskParameters.versionedModules[currentModule]
               );
               await storeMeta(
                  path.join(
                     taskParameters.config.rawConfig.output,
                     currentModule,
                     '.builder/cdn_modules.json'
                  ),
                  taskParameters.versionedModules[currentModule]
               );
            }
         );
      };
   }
   return function skipStoreAdditionalMeta(done) {
      done();
   };
}


/**
 * Generation of the task for static html pages packing.
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * using by current running Gulp-task.
 * @returns {Undertaker.TaskFunction|function(done)} returns an empty function in case of un-appropriate flags to
 * avoid gulp unexpected completion with errors.
 */
function generateTaskForPackHtml(taskParameters) {
   if (!taskParameters.config.deprecatedStaticHtml && taskParameters.config.inlineScripts) {
      return skipPackHtml;
   }
   const depGraph = new DepGraph();
   const { skipTasks, buildTasks } = getPackHtmlTasksFLow(taskParameters, depGraph);

   const packHtml = taskParameters.metrics.createTimer('static html packer');
   return gulp.series(
      packHtml.start(),
      generateTaskForLoadDG(taskParameters.cache, depGraph),
      getParallelTasksOrderByQueue(skipTasks, buildTasks),
      generateStoreMetaTask(taskParameters),
      packHtml.finish()
   );
}

function generateTaskForLoadDG(cache, depGraph) {
   return function loadDependenciesGraph(done) {
      depGraph.fromJSON(cache.getModuleDependencies());
      done();
   };
}

module.exports = generateTaskForPackHtml;
