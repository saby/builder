/**
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');

const logger = require('../../../../lib/logger').logger();
const { path } = require('../../../../lib/platform/path');
const { getTasksTypesByModules } = require('../../../common/compiled-helpers');
const readRouterJson = require('../../plugins/read-router-json');
const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');
const { writeJsonArtifact, filterTargetModule } = require('./utils');

function generateReadRoutersFromModule(taskParameters, workspace, moduleInfo) {
   const gulpSrcOptions = {
      nodir: true,
      allowEmpty: true
   };

   return function readRoutersFromModule() {
      // TODO: подумать, можно ли в этой точке использовать измененные файлы.
      const inputPath = path.join(moduleInfo.path, '**/router.json');

      return (
         gulp
            .src(inputPath, gulpSrcOptions)
            .pipe(handlePipeException('readRoutersFromModule', taskParameters, moduleInfo))
            .pipe(toPosixVinyl(moduleInfo))
            .pipe(readRouterJson(taskParameters, workspace, moduleInfo))
      );
   };
}

function generateSaveArtifacts(taskParameters, workspace) {
   return async function saveArtifacts() {
      try {
         await writeJsonArtifact(
            path.join(workspace.cachePath, 'routes.json'),
            workspace.routes
         );
      } catch (error) {
         logger.debug(`Error routes to cache: ${error.message}`);
      }
   };
}

function generateReadRouterFiles(taskParameters, workspace) {
   // TODO: подумать, можно ли в этой точке использовать измененные модули.
   //    Если можем, то необходимо добавить задачу загрузки данных из кеша.
   //    И предусмотреть условия сброса кеша.
   const { build } = getTasksTypesByModules(
      taskParameters.config.modules,
      false,
      false
   );
   const sourceModules = build.filter(filterTargetModule);
   const buildTasks = sourceModules
      .map(moduleInfo => generateReadRoutersFromModule(taskParameters, workspace, moduleInfo));

   if (buildTasks.length === 0) {
      return function skipReadRouterFiles(done) {
         return done();
      };
   }

   return gulp.series(
      gulp.parallel(buildTasks),
      generateSaveArtifacts(taskParameters, workspace)
   );
}

module.exports = generateReadRouterFiles;
