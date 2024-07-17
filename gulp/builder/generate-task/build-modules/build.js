/**
 * Генерация задачи инкрементальной сборки модулей.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../../lib/platform/path');
const gulp = require('gulp'),
   gulpRename = require('gulp-rename'),
   gulpChmod = require('gulp-chmod'),
   gulpIf = require('gulp-if');

// наши плагины
const packLibrary = require('../../plugins/pack-library'),
   compileJsonToJs = require('../../plugins/compile-json-js'),
   compileLess = require('../../plugins/compile-less'),
   addMissingThemes = require('../../../common/plugins/add-missing-themes'),
   changedInPlace = require('../../../common/plugins/changed-in-place'),
   addIEAndRtlVersionForCss = require('../../plugins/add-ie-and-rtl-version-for-css'),
   buildStaticHtml = require('../../plugins/build-static-html'),
   createNavigationModulesJson = require('../../plugins/create-navigation-modules-json'),
   createVersionedModules = require('../../plugins/create-versioned-modules'),
   createCdnModules = require('../../plugins/create-cdn-modules'),
   indexDictionary = require('../../plugins/index-dictionary'),
   localizeXhtml = require('../../plugins/localize-xhtml'),
   buildTmpl = require('../../plugins/build-tmpl'),
   { processSvg } = require('../../plugins/process-svg'),
   createContentsJson = require('../../plugins/create-contents-json'),
   createLibrariesJson = require('../../plugins/create-libraries-json'),
   createModuleDependenciesJson = require('../../plugins/create-module-dependencies-json'),
   filterCached = require('../../plugins/filter-cached'),
   pushToServer = require('../../plugins/push-to-server'),
   filterSources = require('../../plugins/filter-sources'),
   buildXhtml = require('../../plugins/build-xhtml'),
   minifyCss = require('../../plugins/minify-css'),
   minifyJs = require('../../plugins/minify-js'),
   minifyOther = require('../../plugins/minify-other'),
   packOwnDeps = require('../../plugins/pack-own-deps'),
   versionizeToStub = require('../../plugins/versionize-to-stub'),
   cacheEsFiles = require('../../plugins/cache-ts-files'),
   flushTailwindCss = require('../../plugins/flush-tailwindcss'),
   processSabyThemes = require('../../plugins/process-sabythemes');

const handlePipeException = require('../../../common/plugins/handle-pipe-exception');
const transliterate = require('../../../../lib/transliterate');
const { needSymlink } = require('../../../common/helpers');
const { getModuleInputForBuild } = require('../../../../lib/changed-files/get-module-input');
const toPosixVinyl = require('../../../common/plugins/to-posix-vinyl');

function generateTaskForBuildSingleModule(taskParameters, moduleInfo, modulesMap) {
   const { config } = taskParameters;
   const hasLocalization = config.localizations.length > 0;
   const buildFileModeOptions = { read: true, write: true };
   const generateVersionMeta = !!moduleInfo.version && !taskParameters.config.localStand;

   // there is no need in module-dependencies meta in debug mode. It's only needed by templates that
   // delivers now "as is" and doesn't compile in debug mode. Thus, module-dependencies meta now can be
   // disabled in debug mode too. Also enable it in builder unit test to check if it's properly working.
   const needModuleDependencies = (config.isReleaseMode || moduleInfo.builderTests) && (
      moduleInfo.dependenciesGraph ||
      moduleInfo.customPack ||
      moduleInfo.deprecatedStaticHtml ||
      moduleInfo.checkModuleDependencies
   );

   const pathsForImportSet = new Set();
   for (const modulePath of modulesMap.values()) {
      pathsForImportSet.add(path.dirname(modulePath));
   }

   // Воркер не может принимать мапы в качестве аргумента для функции,
   // только объекты.
   const gulpModulesPaths = {};
   for (const currentModuleName of modulesMap.keys()) {
      gulpModulesPaths[currentModuleName] = modulesMap.get(currentModuleName);
   }

   const gulpSrcOptions = { dot: false, nodir: true };
   const gulpModulesInfo = {
      pathsForImport: [...pathsForImportSet],
      gulpModulesPaths
   };

   return function buildModule() {
      const isWatcherMode = !!taskParameters.config.watcherRunning;

      return (
         gulp
            .src(getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions), gulpSrcOptions)
            .pipe(handlePipeException('buildModule', taskParameters, moduleInfo))
            .pipe(toPosixVinyl())
            .pipe(addMissingThemes(taskParameters, moduleInfo))
            .pipe(flushTailwindCss(moduleInfo))
            .pipe(processSabyThemes(taskParameters, moduleInfo))
            .pipe(addIEAndRtlVersionForCss(taskParameters, moduleInfo))
            .pipe(changedInPlace(taskParameters, moduleInfo))
            .pipe(cacheEsFiles(moduleInfo, true))

            // compileLess зависит от modifyAndProcessJs. Нужно для сбора темизируемых less.
            .pipe(gulpIf(!!moduleInfo.less, compileLess(taskParameters, moduleInfo, gulpModulesInfo)))
            .pipe(
               gulpIf(
                  ((!!moduleInfo.deprecatedWebPageTemplates) || config.generateUMD) && !isWatcherMode,
                  buildStaticHtml(taskParameters, moduleInfo, modulesMap)
               )
            )

            // versionizeToStub зависит от compileLess, buildStaticHtml и gulpBuildHtmlTmpl
            .pipe(
               gulpIf(
                  !!moduleInfo.version && !taskParameters.config.localStand && !isWatcherMode,
                  versionizeToStub(taskParameters, moduleInfo)
               )
            )
            .pipe(gulpIf(hasLocalization && !isWatcherMode, indexDictionary(taskParameters, moduleInfo)))
            .pipe(
               gulpIf(
                  ((
                     !!moduleInfo.deprecatedXhtml && config.isReleaseMode && !moduleInfo.isUnitTestModule

                     // Look at provided options or run plugin in case of using umd mode.
                     // We don't need to compile template in release mode.
                  ) || config.generateUMD) && !isWatcherMode,
                  localizeXhtml(taskParameters, moduleInfo)
               )
            )
            .pipe(
               gulpIf(
                  (
                     !!moduleInfo.wml && config.isReleaseMode && !moduleInfo.isUnitTestModule

                     // Look at provided options or run plugin in case of using umd mode.
                     // We don't need to compile template in release mode.
                  ) || config.generateUMD,
                  buildTmpl(taskParameters, moduleInfo)
               )
            )
            .pipe(
               gulpIf(
                  (
                     !!moduleInfo.deprecatedXhtml && config.isReleaseMode && !moduleInfo.isUnitTestModule

                     // Look at provided options or run plugin in case of using umd mode.
                     // We don't need to compile template in release mode.
                  ) || config.generateUMD,
                  buildXhtml(taskParameters, moduleInfo)
               )
            )
            .pipe(gulpIf(!isWatcherMode, compileJsonToJs(taskParameters, moduleInfo)))

            // packLibrary зависит от modifyAndProcessJs, поскольку нам
            // необходимо правильно записать в кэш информацию о зависимостях
            // запакованной библиотеки, что нужно делать именно после парсинга
            // оригинальной скомпиленной библиотеки.
            // Также в библиотеках нужен кэш шаблонов, чтобы паковать приватные части шаблонов.
            .pipe(
               gulpIf(!!moduleInfo.minimize && !moduleInfo.isUnitTestModule, packLibrary(taskParameters, moduleInfo))
            )

            // packOwnDeps зависит от buildTmp  l, buildXhtml
            .pipe(gulpIf(!!moduleInfo.deprecatedOwnDependencies, packOwnDeps(taskParameters, moduleInfo)))
            .pipe(gulpIf(!!moduleInfo.minimize && !moduleInfo.isUnitTestModule, minifyCss(taskParameters, moduleInfo)))

            // minifyJs зависит от packOwnDeps
            .pipe(gulpIf(!!moduleInfo.minimize && !moduleInfo.isUnitTestModule, minifyJs(taskParameters, moduleInfo)))
            .pipe(
               gulpIf(!!moduleInfo.minimize && !moduleInfo.isUnitTestModule, minifyOther(taskParameters, moduleInfo))
            )

            .pipe(gulpIf(!!moduleInfo.icons && !isWatcherMode, processSvg(taskParameters, moduleInfo)))

            // createVersionedModules и createCdnModules зависит от versionizeToStub
            .pipe(gulpIf(generateVersionMeta && !isWatcherMode, createVersionedModules(taskParameters, moduleInfo)))
            .pipe(gulpIf(generateVersionMeta && !isWatcherMode, createCdnModules(taskParameters, moduleInfo)))
            .pipe(
               gulpIf(
                  !!moduleInfo.presentationServiceMeta && !isWatcherMode,
                  createNavigationModulesJson(taskParameters, moduleInfo)
               )
            )

            // createContentsJson зависит от buildStaticHtml и modifyAndProcessJs
            .pipe(gulpIf(config.contents && !isWatcherMode, createContentsJson(taskParameters, moduleInfo)))
            .pipe(gulpIf(!!moduleInfo.customPack && !isWatcherMode, createLibrariesJson(taskParameters, moduleInfo)))

            // For the record, gulp-if has a strange logic:
            // if it gets undefined as a condition, plugin executes in any case.
            // So convert condition to logic constant to avoid that behavior
            .pipe(
               gulpIf(
                  !!needModuleDependencies && !isWatcherMode,
                  createModuleDependenciesJson(taskParameters, moduleInfo)
               )
            )
            .pipe(gulpIf(!isWatcherMode, filterCached(taskParameters, moduleInfo)))

            // В cache-ts-files определяется неперечислимое свойство cachedJsFile, которое
            // при клонировании через file.clone потеряется и у нас будет во время работы
            // билда ещё раз записываться в output js-файл, при этом шаблонизатор будет
            // вызывать эти файлы через require. Это приводит к непредсказуемым ошибкам,
            // когда параллельно gulp пишет файл на диск и делает его недоступным и
            // одновременно с этим require пытается этот же файл грузить в воркере для
            // шаблонизатора, в ответ require получает undefined ибо файл недоступен и не
            // может быть исполнен, отсюда и рандомные плавающие ошибки сборки.
            // Поэтому gulpRename(он внутри делает file.clone) выполняем обязательно после
            // фильтрации файлов для конечной записи на диск!
            .pipe(
               gulpRename((file) => {
                  file.dirname = transliterate(file.dirname);
                  file.basename = transliterate(file.basename);
               })
            )
            .pipe(pushToServer(taskParameters, moduleInfo))
            .pipe(
               gulpIf(
                  config.isSourcesOutput && !isWatcherMode,
                  filterSources()
               )
            )
            .pipe(gulpChmod(buildFileModeOptions))
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

module.exports = generateTaskForBuildSingleModule;
