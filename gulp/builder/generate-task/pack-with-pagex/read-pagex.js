/**
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');

const logger = require('../../../../lib/logger').logger();
const { path } = require('../../../../lib/platform/path');
const { getTasksTypesByModules } = require('../../../common/compiled-helpers');
const readPageXFiles = require('../../plugins/read-pagex-files');
const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');
const generateGetPageXLayouts = require('./get-layouts');
const { writeJsonArtifact, filterTargetModule } = require('./utils');

function generateReadPageXFromModule(taskParameters, workspace, moduleInfo) {
   const gulpSrcOptions = {
      nodir: true,
      allowEmpty: true
   };

   return function readPageXFilesFromModule() {
      // TODO: подумать, можно ли в этой точке использовать измененные файлы.
      const inputPath = path.join(moduleInfo.path, '**/*.pagex');

      return (
         gulp
            .src(inputPath, gulpSrcOptions)
            .pipe(handlePipeException('readPageXFilesFromModule', taskParameters, moduleInfo))
            .pipe(toPosixVinyl(moduleInfo))
            .pipe(readPageXFiles(taskParameters, workspace, moduleInfo))
      );
   };
}

function generateSaveArtifacts(taskParameters, workspace) {
   return async function saveArtifacts() {
      try {
         await writeJsonArtifact(
            path.join(workspace.cachePath, 'registry.json'),
            workspace.registry.json
         );

         await writeJsonArtifact(
            path.join(workspace.cachePath, 'layouts.json'),
            workspace.layouts
         );
      } catch (error) {
         logger.debug(`Error writing registry state to cache: ${error.message}`);
      }
   };
}

function generateReadPageX(taskParameters, workspace) {
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
      .map(moduleInfo => generateReadPageXFromModule(taskParameters, workspace, moduleInfo));

   if (buildTasks.length === 0) {
      return function skipCollectPageXFiles(done) {
         return done();
      };
   }


   return gulp.series(
      generateGetPageXLayouts(taskParameters, workspace),
      gulp.parallel(buildTasks),
      generateSaveArtifacts(taskParameters, workspace),
   );
}

module.exports = generateReadPageX;
