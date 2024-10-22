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
const buildTs = require('../../plugins/build-ts'),
   changedInPlace = require('../../../common/plugins/changed-in-place'),
   modifyAndProcessJs = require('../../plugins/modify-and-process-js'),
   filterCached = require('../../plugins/filter-cached'),
   pushToServer = require('../../plugins/push-to-server'),
   filterSources = require('../../plugins/filter-sources'),
   cacheEsFiles = require('../../plugins/cache-ts-files'),
   createSourceMap = require('../../plugins/create-source-map'),
   compileJsonToJs = require('../../plugins/compile-json-js');

const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const transliterate = require('../../../../lib/transliterate');

const { needSymlink } = require('../../../common/helpers');
const { getModuleInputForCompile } = require('../../../../lib/changed-files/get-module-input');
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');
const getMetricsReporter = require('../../../common/classes/metrics-reporter');

function genTaskForCompileSingleModule(taskParameters, moduleInfo) {
   const { config } = taskParameters;
   const compileFileModeOptions = { read: true, write: true };
   const gulpSrcOptions = { dot: false, nodir: true };

   return function compileModule(done) {
      const isWatcherMode = !!taskParameters.config.watcherRunning;

      const sources = getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions);

      if (sources.length === 0) {
         return done();
      }

      getMetricsReporter().markBuiltModule(moduleInfo);

      return (
         gulp
            .src(sources, gulpSrcOptions)
            .pipe(handlePipeException('compileModule', taskParameters, moduleInfo))
            .pipe(toPosixVinyl())
            .pipe(changedInPlace(taskParameters, moduleInfo))
            .pipe(gulpIf(
               !!(taskParameters.config.sourceMaps || taskParameters.config.inlineSourceMaps),
               createSourceMap(taskParameters, moduleInfo)
            ))
            .pipe(gulpIf(
               !!((taskParameters.config.typescript && moduleInfo.typescript) || taskParameters.config.emitTypescript),
               buildTs(taskParameters, moduleInfo)
            ))
            .pipe(modifyAndProcessJs(taskParameters, moduleInfo))
            .pipe(gulpIf(!isWatcherMode, compileJsonToJs(taskParameters, moduleInfo)))
            .pipe(cacheEsFiles(moduleInfo))
            .pipe(
               gulpRename((file) => {
                  file.dirname = transliterate(file.dirname);
                  file.basename = transliterate(file.basename);
               })
            )
            .pipe(gulpIf(!isWatcherMode, filterCached(taskParameters, moduleInfo)))
            .pipe(pushToServer(taskParameters, moduleInfo))
            .pipe(
               gulpIf(
                  config.isSourcesOutput && !isWatcherMode,
                  filterSources()
               )
            )
            .pipe(gulpChmod(compileFileModeOptions))
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
