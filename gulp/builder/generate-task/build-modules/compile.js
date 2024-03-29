/**
 * Генерация задачи инкрементальной сборки модулей.
 * @author Kolbeshin F.A.
 */

'use strict';

const
   gulp = require('gulp'),
   gulpRename = require('gulp-rename'),
   gulpChmod = require('gulp-chmod'),
   gulpIf = require('gulp-if');

// наши плагины
const compileEsAndTs = require('../../plugins/compile-es-and-ts'),
   loadJsByTsc = require('../../plugins/load-js-by-tsc'),
   changedInPlace = require('../../../common/plugins/changed-in-place'),
   modifyAndProcessJs = require('../../plugins/modify-and-process-js'),
   filterCached = require('../../plugins/filter-cached'),
   pushToServer = require('../../plugins/push-to-server'),
   filterSources = require('../../plugins/filter-sources'),
   cacheEsFiles = require('../../plugins/cache-ts-files');

const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const transliterate = require('../../../../lib/transliterate');

const { needSymlink } = require('../../../common/helpers');
const { getModuleInputForCompile } = require('../../../../lib/changed-files/get-module-input');
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');

function genTaskForCompileSingleModule(taskParameters, moduleInfo) {
   const { config } = taskParameters;
   const gulpSrcOptions = { dot: false, nodir: true };

   return function compileModule() {
      return (
         gulp
            .src(getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions), gulpSrcOptions)
            .pipe(handlePipeException('compileModule', taskParameters, moduleInfo))
            .pipe(toPosixVinyl())
            .pipe(changedInPlace(taskParameters, moduleInfo))
            .pipe(gulpIf(
               !!moduleInfo.typescript,
               compileEsAndTs(taskParameters, moduleInfo)
            ))
            .pipe(gulpIf(
               !!taskParameters.config.emitTypescript,
               loadJsByTsc(taskParameters, moduleInfo)
            ))
            .pipe(modifyAndProcessJs(taskParameters, moduleInfo))
            .pipe(cacheEsFiles(moduleInfo))
            .pipe(
               gulpRename((file) => {
                  file.dirname = transliterate(file.dirname);
                  file.basename = transliterate(file.basename);
               })
            )
            .pipe(filterCached(taskParameters, moduleInfo))
            .pipe(pushToServer(taskParameters, moduleInfo))
            .pipe(gulpIf(config.isSourcesOutput, filterSources()))
            .pipe(gulpChmod({ read: true, write: true }))
            .pipe(
               gulpIf(
                  needSymlink(taskParameters, config, moduleInfo, taskParameters.cache.isFirstBuild()),
                  gulp.symlink(moduleInfo.output),
                  gulp.dest(moduleInfo.output)
               )
            )
      );
   };
}

module.exports = genTaskForCompileSingleModule;
