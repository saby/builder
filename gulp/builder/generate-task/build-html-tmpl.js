/**
 * Генерация задачи инкрементальной сборки шаблонов *.html.tmpl
 *
 * В данной задаче используются знания о уже собранных шаблонах *.tmpl,
 * среди которых также есть шаблоны *.html.tmpl. Таким образом,
 * на начальном этапе мы пропускаем обработку тех UI модулей,
 * которые не содержат требуемых шаблонов.
 *
 * @author Kolbeshin F.A.
 * @author Krylov M.A.
 */

'use strict';

const gulp = require('gulp');
const gulpRename = require('gulp-rename');
const gulpIf = require('gulp-if');
const gulpChmod = require('gulp-chmod');
const fs = require('fs-extra');

const logger = require('../../../lib/logger').logger();

const { getTasksTypesByModules } = require('../../common/compiled-helpers');
const getBuildStatusStorage = require('../../common/classes/build-status');

const { path } = require('../../../lib/platform/path');
const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const gulpBuildHtmlTmpl = require('../plugins/build-html-tmpl');
const versionizeToStub = require('../plugins/versionize-to-stub');
const createVersionedModules = require('../plugins/create-versioned-modules');
const createCdnModules = require('../plugins/create-cdn-modules');
const transliterate = require('../../../lib/transliterate');
const { needSymlink } = require('../../common/helpers');
const toPosixVinyl = require('../../common/plugins/to-posix-vinyl');
const getMetricsReporter = require('../../common/classes/metrics-reporter');
const { getPrettyPath } = require('../../../lib/modulepath-to-require');

const EMPTY_ARRAY = Object.freeze([]);

function skipBuildHtmlTmpl(done) {
   done();
}

function getCacheFilePath(cacheDirectory) {
   return path.join(cacheDirectory, 'html-tmpl-files.json');
}

function toModuleName(fileName) {
   const prettyFileName = getPrettyPath(fileName);

   if (/\.(tsx?|jsx?)$/gi.test(prettyFileName)) {
      return prettyFileName.replace(/\.(tsx?|jsx?)$/gi, '');
   }

   if (/\.(css|less)$/gi.test(prettyFileName)) {
      return `css!${prettyFileName.replace(/\\.(css|less)$/gi, '')}`;
   }

   if (/\.wml$/gi.test(prettyFileName)) {
      return `wml!${prettyFileName.replace(/\\.wml$/gi, '')}`;
   }

   if (/\.tmpl$/gi.test(prettyFileName)) {
      return `tmpl!${prettyFileName.replace(/\\.tmpl$/gi, '')}`;
   }

   if (/\.xhtml$/gi.test(prettyFileName)) {
      return `html!${prettyFileName.replace(/\\.html$/gi, '')}`;
   }

   if (/\.json$/gi.test(prettyFileName)) {
      return `json!${prettyFileName.replace(/\\.json$/gi, '')}`;
   }

   return prettyFileName;
}

function collectChangedComponents(taskParameters) {
   const followsContract = moduleInfo => (
      moduleInfo.changedFiles instanceof Array &&
      moduleInfo.deletedFiles instanceof Array
   );

   if (!taskParameters.config.modules.every(followsContract)) {
      taskParameters.htmlTmplFiles.forceRebuild = true;

      return;
   }

   logger.debug('Собираем список изменений перед обработкой html.tmpl');

   const changedComponents = new Set();

   taskParameters.config.modules.forEach((moduleInfo) => {
      for (const relFilePath of moduleInfo.changedFiles) {
         changedComponents.add(toModuleName(path.join(moduleInfo.outputName, relFilePath)));
      }
   });

   taskParameters.htmlTmplFiles.changedComponents = changedComponents;
   taskParameters.htmlTmplFiles.changedComponentsCache = new Map();
}

function generateTaskForLoadCache(taskParameters) {
   return async function loadHtmlTmplCache() {
      const filePath = getCacheFilePath(taskParameters.config.cachePath);

      if (await fs.pathExists(filePath)) {
         const cache = await fs.readJson(filePath);

         taskParameters.config.modules.forEach((moduleInfo) => {
            if (!cache.hasOwnProperty(moduleInfo.outputName)) {
               // Кеш не содержит информации об этом модуле. Объединять нечего.
               return;
            }

            const current = taskParameters.htmlTmplFiles[moduleInfo.outputName] || EMPTY_ARRAY;
            let cached = cache[moduleInfo.outputName];

            if (moduleInfo.deletedFiles instanceof Array) {
               // Исключаем удаленные шаблоны
               const normalizedFiles = moduleInfo.deletedFiles.map(file => file.replace(/^\.\//gi, ''));

               cached = cached.filter(file => !normalizedFiles.includes(file));
            }

            taskParameters.htmlTmplFiles[moduleInfo.outputName] = Array.from(new Set([...current, ...cached]));
         });
      }

      taskParameters.htmlTmplFiles.forceRebuild = (
         taskParameters.cache.isFirstBuild() ||
         taskParameters.cache.dropCacheForStaticMarkup ||
         getBuildStatusStorage().cacheIsDropped
      );

      if (taskParameters.htmlTmplFiles.forceRebuild) {
         return;
      }

      collectChangedComponents(taskParameters);
   };
}

function cleanDependencyName(dependency) {
   return dependency
      .replace('optional!', '')
      .replace('browser!', '')
      .replace('is!browser?', '');
}

function containsChangedModule(rawDependency, moduleDependencies, changedComponents, cache) {
   const dependency = cleanDependencyName(rawDependency);

   if (cache.has(dependency)) {
      return cache.get(dependency);
   }

   if (!moduleDependencies.links.hasOwnProperty(dependency)) {
      return false;
   }

   const isChangedDependency = changedComponents.has(dependency);

   cache.set(dependency, isChangedDependency);

   if (isChangedDependency) {
      return isChangedDependency;
   }

   return moduleDependencies.links[dependency].some(innerDependency => containsChangedModule(
      innerDependency,
      moduleDependencies,
      changedComponents,
      cache
   ));
}

function getInputFiles(taskParameters, moduleInfo) {
   const { config, cache, htmlTmplFiles } = taskParameters;

   if (!config.isWmlPluginEnabled(moduleInfo)) {
      // Плагин buildTmpl не отработал, поэтому не имеем списка целевых шаблонов.
      // Выполняем обработку модуля с помощью wildcard.
      return path.join(moduleInfo.path, '/**/*.html.tmpl');
   }

   if (!htmlTmplFiles.hasOwnProperty(moduleInfo.outputName)) {
      // Модуль не содержит требуемых шаблонов.
      return EMPTY_ARRAY;
   }

   if (htmlTmplFiles.forceRebuild || moduleInfo.forceRebuild || !config.isDependenciesEnabled(moduleInfo)) {
      // Не можем или не нужно смотреть изменения по зависимостям,
      // поэтому собираем только те шаблоны, которые определили сами.
      return htmlTmplFiles[moduleInfo.outputName].map(filePath => path.join(moduleInfo.path, filePath));
   }

   logger.debug(`Проверяем изменения html.tmpl для модуля ${moduleInfo.outputName}`);

   const containsChangedModuleFilter = filePath => containsChangedModule(
      toModuleName(path.join(moduleInfo.outputName, filePath)),
      cache.getModuleDependencies(),
      htmlTmplFiles.changedComponents,
      htmlTmplFiles.changedComponentsCache
   );

   return htmlTmplFiles[moduleInfo.outputName]
      .filter(containsChangedModuleFilter)
      .map(filePath => path.join(moduleInfo.path, filePath));
}

function createBuildModulePipeline(taskParameters, moduleInfo, inputFiles) {
   const { config } = taskParameters;
   const gulpSrcOptions = { dot: false, nodir: true };
   const templatesFileModeOptions = { read: true, write: true };
   const generateVersionMeta = !!moduleInfo.version && !taskParameters.config.localStand;

   return (
      gulp
         .src(inputFiles, gulpSrcOptions)
         .pipe(handlePipeException('buildHtmlTmpl', taskParameters, moduleInfo))
         .pipe(toPosixVinyl())
         .pipe(gulpBuildHtmlTmpl(taskParameters, moduleInfo))
         .pipe(gulpIf(!!moduleInfo.version && config.isReleaseMode, versionizeToStub(taskParameters, moduleInfo)))
         .pipe(gulpIf(generateVersionMeta, createVersionedModules(taskParameters, moduleInfo)))
         .pipe(gulpIf(generateVersionMeta, createCdnModules(taskParameters, moduleInfo)))
         .pipe(
            gulpRename((file) => {
               file.dirname = transliterate(file.dirname);
               file.basename = transliterate(file.basename);
            })
         )
         .pipe(gulpChmod(templatesFileModeOptions))
         .pipe(
            gulpIf(
               needSymlink(taskParameters, config, moduleInfo, taskParameters.cache.isFirstBuild()),
               gulp.symlink(moduleInfo.output),
               gulp.dest(moduleInfo.output)
            )
         )
   );
}

function generateTaskForBuildSingleModule(taskParameters, moduleInfo) {
   return function buildSingleModule(done) {
      const inputFiles = getInputFiles(taskParameters, moduleInfo);

      if (inputFiles.length === 0) {
         // Нет файлов для обработки
         return done();
      }

      moduleInfo.htmlTmplChanged = true;
      getMetricsReporter().markBuiltModule(moduleInfo);

      logger.debug(`Собираем html.tmpl для модуля ${moduleInfo.outputName}: ${JSON.stringify(inputFiles)}`);

      return createBuildModulePipeline(taskParameters, moduleInfo, inputFiles);
   };
}

function generateTaskForSaveCache(taskParameters) {
   return function saveHtmlTmplCache() {
      const filePath = getCacheFilePath(taskParameters.config.cachePath);

      return fs.writeJson(filePath, taskParameters.htmlTmplFiles, {
         encoding: 'utf-8',
         spaces: 3
      });
   };
}

function generateTaskForBuildHtmlTmpl(taskParameters) {
   if (!taskParameters.config.htmlWml) {
      return skipBuildHtmlTmpl;
   }

   const { build } = getTasksTypesByModules(
      taskParameters.config.modules,
      false,
      taskParameters.config.watcherRunning
   );

   const tasks = build.map(moduleInfo => generateTaskForBuildSingleModule(taskParameters, moduleInfo));

   if (tasks.length === 0) {
      return skipBuildHtmlTmpl;
   }

   return gulp.series(
      generateTaskForLoadCache(taskParameters),
      gulp.parallel(tasks),
      generateTaskForSaveCache(taskParameters)
   );
}

module.exports = generateTaskForBuildHtmlTmpl;
