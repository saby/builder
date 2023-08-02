/* eslint-disable no-sync */
/**
 * Генерирует поток выполнения сборки одного less файла при измении
 * Вызывается из WebStorm, например.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toPosix } = require('../../lib/platform/path');
const gulp = require('gulp'),
   gulpIf = require('gulp-if'),
   fs = require('fs-extra'),
   gulpRename = require('gulp-rename'),
   gulpChmod = require('gulp-chmod'),
   mapStream = require('map-stream'),
   modifyAndProcessJs = require('./plugins/modify-and-process-js'),
   minifyCss = require('./plugins/minify-css'),
   minifyJs = require('./plugins/minify-js'),

   packLibrary = require('./plugins/pack-library'),
   minifyOther = require('./plugins/minify-other'),
   buildXhtml = require('./plugins/build-xhtml'),
   buildTmpl = require('./plugins/build-tmpl'),
   gulpBuildHtmlTmpl = require('./plugins/build-html-tmpl'),
   cacheEsFiles = require('./plugins/cache-ts-files');

const handlePipeException = require('../common/plugins/handle-pipe-exception');

const Cache = require('./classes/cache'),
   Configuration = require('./classes/configuration.js'),
   ConfigurationReader = require('../common/configuration-reader'),
   { generateTaskForMarkThemeModules } = require('./generate-task/mark-theme-modules'),
   TaskParameters = require('../common/classes/task-parameters'),
   changedInPlace = require('../common/plugins/changed-in-place'),
   compileLess = require('./plugins/compile-less'),
   buildTs = require('./plugins/build-ts'),
   logger = require('../../lib/logger').logger(),
   transliterate = require('../../lib/transliterate'),
   pushChanges = require('../../lib/push-changes'),
   { generateDownloadModuleCache, generateSaveModuleCache } = require('./classes/modules-cache'),
   { generateJoinedThemes } = require('../../lib/save-themes');

const toPosixVinyl = require('../common/plugins/to-posix-vinyl');
const { enableLockfileFeature } = require('../../lib/with-lockfile');

const {
   needSymlink,
   generateTaskForLoadCache,
   generateTaskForInitWorkerPool,
   generateTaskForTerminatePool, generateTaskForSaveCache
} = require('../common/helpers');

// watcher's mini task for generating of themes.
function generateSaveThemesTask(taskParameters, themesParts) {
   return async function saveThemesMeta() {
      // don't waste time if there is no changes in themes parts
      if (themesParts.length > 0) {
         const root = taskParameters.config.rawConfig.output;
         const fileSuffix = taskParameters.config.isReleaseMode ? '.min' : null;
         const isThemeForReleaseOnly = !taskParameters.config.sources && taskParameters.config.isReleaseMode;
         const themesMeta = taskParameters.cache.getThemesMetaForWatcher();
         themesParts.forEach((currentThemePart) => {
            const themeName = themesMeta.themesMap[currentThemePart.replace('.less', '')];
            taskParameters.addChangedFile(`ThemesModule/${themeName}.css`);
            taskParameters.removeChangedFile(currentThemePart.replace('.less', '.css'));
         });
         const resourceRoot = `${taskParameters.config.applicationForRebase}${taskParameters.config.resourcesUrl ? 'resources/' : ''}`;
         await generateJoinedThemes(
            taskParameters,
            root,
            isThemeForReleaseOnly,
            fileSuffix,
            themesMeta.themes,
            resourceRoot
         );
      }
   };
}

/**
 * Генерирует поток выполнения сборки одного less файла при измении
 * @param {string[]} processArgv массив аргументов запуска утилиты
 * @returns {Undertaker.TaskFunction} gulp задача
 */
function generateBuildWorkflowOnChange(processArgv) {
   const { filePath, hotReloadPort } = ConfigurationReader.getProcessParameters(processArgv);

   // загрузка конфигурации должна быть синхронной, иначе не построятся задачи для сборки модулей
   const config = new Configuration();
   config.loadSync(processArgv);
   if (!filePath) {
      throw new Error('Не указан параметр --filePath');
   }

   // if hot reload port is selected by user, use it to push changes
   if (hotReloadPort) {
      config.staticServer = `localhost:${hotReloadPort}`;
   }

   const taskParameters = new TaskParameters(config, new Cache(config));

   // skip collectThemes task for non-less files rebuilding
   if (!filePath.endsWith('.less')) {
      taskParameters.config.less = false;
   }

   // в режиме watcher tsc не запускаем, тут как раз уместен одиночный
   // билд ts-файлов.
   taskParameters.config.emitTypescript = false;

   // в режиме watcher чтение и запись файлов кеша осуществляется только с помощью lock-файлов,
   // чтобы не допустить одновременной работы с одним файлом из нескольких параллельных процессов
   enableLockfileFeature();

   let currentModuleInfo;
   const pathsForImportSet = new Set();
   let filePathInProject = toPosix(filePath);
   const gulpModulesPaths = {};

   for (const moduleInfo of taskParameters.config.modules) {
      gulpModulesPaths[moduleInfo.name] = moduleInfo.path;

      if (!currentModuleInfo) {
         let relativePath = path.relative(moduleInfo.path, filePath);

         // на windows если два файла на разных дисках, то path.relative даёт путь от диска, без ..
         if (!relativePath.includes('..') && !path.isAbsolute(relativePath)) {
            currentModuleInfo = moduleInfo;
         } else {
            /**
             * если модуль задан через симлинк, попробуем сопоставить файл и модуль
             * Также резолвим реальный путь на случай, если разработчики подрубают к вотчеру
             * Интерфейсные модули, описанные через симлинки.
             */
            const realModulePath = fs.realpathSync(moduleInfo.path);
            if (fs.existsSync(filePath)) {
               const realFilePath = fs.realpathSync(filePath);
               relativePath = path.relative(realModulePath, realFilePath);
               if (!relativePath.includes('..') && !path.isAbsolute(relativePath)) {
                  currentModuleInfo = moduleInfo;
                  filePathInProject = path.join(moduleInfo.path, relativePath);
               }
            }
         }
      }
      pathsForImportSet.add(moduleInfo.appRoot);
   }
   const gulpModulesInfo = {
      pathsForImport: [...pathsForImportSet],
      gulpModulesPaths
   };

   if (!currentModuleInfo) {
      logger.info(`Файл ${filePathInProject} вне проекта`);
      return function skipWatcher(done) {
         done();
      };
   }

   currentModuleInfo.fileHashCheck = false;

   // guardSingleProcess пришлось убрать из-за того что WebStorm может вызвать несколько процессов параллельно
   return gulp.series(
      generateTaskForLoadCache(taskParameters),
      generateTaskForCheckVersion(taskParameters),
      generateTaskForInitWorkerPool(taskParameters, config.outputPath),
      generateTaskForMarkThemeModules(taskParameters, config),
      generateTaskForBuildFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject),
      generateTaskForSaveCache(taskParameters, true),
      generateTaskForPushOfChanges(taskParameters),
      generateTaskForTerminatePool(taskParameters)
   );
}

function isTsFile(fileName) {
   return /\.(tsx?|js|es)$/gi.test(fileName);
}

function isNotTsFile(fileName) {
   return !isTsFile(fileName);
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

function generateCompileFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject, themesParts) {
   return function compileFile() {
      const prettyRoot = path.dirname(currentModuleInfo.path);
      const filesToBuild = taskParameters.cache.getAllFilesToBuild(
         filePathInProject,
         prettyRoot,
         themesParts
      );
      const currentModuleOutput = path.join(
         taskParameters.config.rawConfig.output,
         currentModuleInfo.runtimeModuleName
      );
      const gulpSrcOptions = {
         dot: false,
         nodir: true,
         base: currentModuleInfo.path
      };
      const inputFiles = filesToBuild.filter(isTsFile);

      if (inputFiles.length === 0) {
         return Promise.resolve();
      }

      logger.info(`These are files to be recompiled: ${JSON.stringify(inputFiles, null, 3)}`);

      return (
         gulp
            .src(filesToBuild, gulpSrcOptions)
            .pipe(handlePipeException('buildModule', taskParameters, currentModuleInfo))
            .pipe(toPosixVinyl())
            .pipe(changedInPlace(taskParameters, currentModuleInfo))
            .pipe(buildTs(taskParameters, currentModuleInfo))
            .pipe(modifyAndProcessJs(taskParameters, currentModuleInfo))
            .pipe(cacheEsFiles(currentModuleInfo))
            .pipe(
               gulpRename((file) => {
                  file.dirname = transliterate(file.dirname);
                  file.basename = transliterate(file.basename);
               })
            )
            .pipe(gulpChmod({ read: true, write: true }))
            .pipe(mapStream((file, callback) => {
               if (!['.ts', '.less'].includes(file.pExtname)) {
                  // don't push information about minified files onto hot reload server, it's useless and
                  // ruins debugging, because minified version overwrites debug version
                  if (!path.basename(file.pPath).endsWith(`.min${file.pExtname}`)) {
                     const outputFilePath = path.join(
                        currentModuleInfo.runtimeModuleName,
                        file.pRelative
                     );
                     taskParameters.addChangedFile(outputFilePath);
                  }
               }
               callback(null, file);
            }))
            .pipe(
               gulpIf(
                  needSymlink(taskParameters, taskParameters.config, currentModuleInfo),
                  gulp.symlink(currentModuleInfo.output),
                  gulp.dest(currentModuleInfo.output)
               )
            )
            .pipe(
               gulpIf(
                  taskParameters.config.isReleaseMode,
                  gulp.dest(currentModuleOutput)
               )
            )
      );
   };
}

function generateBuildFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject, themesParts) {
   return function buildFile() {
      const prettyRoot = path.dirname(currentModuleInfo.path);
      const filesToBuild = taskParameters.cache.getAllFilesToBuild(
         filePathInProject,
         prettyRoot,
         themesParts
      );
      const currentModuleOutput = path.join(
         taskParameters.config.rawConfig.output,
         currentModuleInfo.runtimeModuleName
      );
      const gulpSrcOptions = {
         dot: false,
         nodir: true,
         base: currentModuleInfo.path
      };
      const inputFiles = filesToBuild.filter(isNotTsFile);

      if (inputFiles.length === 0) {
         // It's necessary to run this phase because there can be some files stored by cacheEsFiles plugin,
         // or waiting for packing or minification.
         gulpSrcOptions.allowEmpty = true;
         inputFiles.push(currentModuleInfo.path);
      }

      logger.info(`These are files to be rebuilt: ${JSON.stringify(inputFiles, null, 3)}`);

      return (
         gulp
            .src(inputFiles, gulpSrcOptions)
            .pipe(handlePipeException('buildModule', taskParameters, currentModuleInfo))
            .pipe(toPosixVinyl())
            .pipe(changedInPlace(taskParameters, currentModuleInfo))
            .pipe(cacheEsFiles(currentModuleInfo, true))
            .pipe(compileLess(taskParameters, currentModuleInfo, gulpModulesInfo))
            .pipe(gulpIf(taskParameters.config.htmlWml, gulpBuildHtmlTmpl(taskParameters, currentModuleInfo)))
            .pipe(
               gulpIf(
                  (
                     !!taskParameters.config.wml && taskParameters.config.isReleaseMode

                     // Look at provided options or run plugin in case of using umd mode.
                     // We don't need to compile template in release mode.
                  ) || taskParameters.config.generateUMD,
                  buildTmpl(taskParameters, currentModuleInfo)
               )
            )
            .pipe(
               gulpIf(
                  (
                     !!taskParameters.config.deprecatedXhtml && taskParameters.config.isReleaseMode

                     // Look at provided options or run plugin in case of using umd mode.
                     // We don't need to compile template in release mode.
                  ) || taskParameters.config.generateUMD,
                  buildXhtml(taskParameters, currentModuleInfo)
               )
            )
            .pipe(
               gulpRename((file) => {
                  file.dirname = transliterate(file.dirname);
                  file.basename = transliterate(file.basename);
               })
            )
            .pipe(gulpIf(taskParameters.config.minimize, packLibrary(taskParameters, currentModuleInfo)))
            .pipe(gulpIf(taskParameters.config.minimize, minifyCss(taskParameters, currentModuleInfo)))

            // minifyJs зависит от packOwnDeps
            .pipe(gulpIf(taskParameters.config.minimize, minifyJs(taskParameters, currentModuleInfo)))

            .pipe(gulpIf(taskParameters.config.minimize, minifyOther(taskParameters, currentModuleInfo)))
            .pipe(gulpChmod({ read: true, write: true }))
            .pipe(mapStream((file, callback) => {
               if (!['.ts', '.less'].includes(file.pExtname)) {
                  // don't push information about minified files onto hot reload server, it's useless and
                  // ruins debugging, because minified version overwrites debug version
                  if (!path.basename(file.pPath).endsWith(`.min${file.pExtname}`)) {
                     const outputFilePath = path.join(
                        currentModuleInfo.runtimeModuleName,
                        file.pRelative
                     );
                     taskParameters.addChangedFile(outputFilePath);
                  }
               }
               callback(null, file);
            }))
            .pipe(
               gulpIf(
                  needSymlink(taskParameters, taskParameters.config, currentModuleInfo),
                  gulp.symlink(currentModuleInfo.output),
                  gulp.dest(currentModuleInfo.output)
               )
            )
            .pipe(
               gulpIf(
                  taskParameters.config.isReleaseMode,
                  gulp.dest(currentModuleOutput)
               )
            )
      );
   };
}

function generateTaskForBuildFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject) {
   const themesParts = [];

   const buildFile = taskParameters.metrics.createTimer('buildModule');
   return gulp.series(
      buildFile.start(),

      // set a sign of patch build to get a whole module cache
      // for instance, es compile cache and markup cache, for proper library packing
      generateDownloadModuleCache(taskParameters, currentModuleInfo, true),
      generateCompileFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject, themesParts),
      generateBuildFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject, themesParts),
      generateSaveModuleCache(taskParameters, currentModuleInfo),
      generateSaveThemesTask(taskParameters, themesParts),
      buildFile.finish()
   );
}

function generateTaskForCheckVersion(taskParameters) {
   return function checkBuilderVersion(done) {
      const lastVersion = taskParameters.cache.lastStore.versionOfBuilder,
         currentVersion = taskParameters.cache.currentStore.versionOfBuilder;
      if (lastVersion !== currentVersion) {
         logger.error(
            `Текущая версия Builder'а (${currentVersion}) не совпадает с версией, ` +
               `сохранённой в кеше (${lastVersion}). ` +
               'Вероятно, необходимо передеплоить стенд.'
         );
      }
      done();
   };
}

module.exports = generateBuildWorkflowOnChange;
