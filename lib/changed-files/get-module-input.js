'use strict';

const { path } = require('../platform/path');
const logger = require('../logger').logger();
const toNegativeGlob = s => `!${s}`;
const MINIFIED_EXTENSIONS_TO_COMPRESS = ['js', 'json', 'css', 'tmpl', 'wml', 'xhtml'];
const MINIFIED_FILE_TO_COMPRESS = new RegExp(`.+?\\.min\\.(${MINIFIED_EXTENSIONS_TO_COMPRESS.join('|')})$`);
const { moduleHasNoChanges } = require('../helpers');

function getPathWithoutModuleName(pathWithModuleName) {
   const parts = pathWithModuleName.split('/');

   // remove moduleName from name
   parts.shift();
   return parts.join('/');
}

function isSourceFile(fileName) {
   return /\.(tsx?|js|es|json)$/gi.test(fileName);
}

function setDefaultChangedFilesOptions(moduleInfo, gulpSrcOptions) {
   moduleInfo.fileHashCheck = false;
   gulpSrcOptions.allowEmpty = true;
   gulpSrcOptions.base = moduleInfo.path;
}

/**
 * get patterns of files to read by drop cache flags
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {*[]}
 */
function getInputForDropCacheCases(taskParameters, moduleInfo) {
   const result = [];

   if (taskParameters.cache.dropCacheForLess) {
      result.push(path.join(moduleInfo.path, '/**/*.less'));
   }

   if (taskParameters.cache.dropCacheForOldMarkup) {
      result.push(path.join(moduleInfo.path, '/**/*.xhtml'));
   }

   if (taskParameters.cache.dropCacheForMarkup) {
      result.push(path.join(moduleInfo.path, '/**/*.tmpl'));
      result.push(path.join(moduleInfo.path, '/**/*.wml'));
   }

   if (taskParameters.config.changedFilesWithDependencies[moduleInfo.outputName]) {
      const currentChangedFiles = taskParameters.config.changedFilesWithDependencies[moduleInfo.outputName];
      currentChangedFiles.forEach((currentPath) => {
         const relativePath = getPathWithoutModuleName(currentPath);
         switch (path.extname(relativePath)) {
            case '.less':
               if (taskParameters.cache.dropCacheForLess) {
                  return;
               }
               break;
            case '.xhtml':
               if (taskParameters.cache.dropCacheForOldMarkup) {
                  return;
               }
               break;
            case '.tmpl':
            case '.wml':
               if (taskParameters.cache.dropCacheForMarkup) {
                  return;
               }
               break;
            case '.html.tmpl':
               // Шаблоны .html.tmpl собираются в отдельной задаче
               return;
            default:
               break;
         }
         result.push(path.join(moduleInfo.path, relativePath));
      });
   }

   return result;
}

/**
 * get changed files list to read
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @param {Function} filterFunction - function to filter given array
 * @param {Object} options - additional options to get additional read patterns
 * @returns {*[]}
 */
function getChangedFilesList(taskParameters, moduleInfo, filterFunction, options = {}) {
   const {
      additionalPatterns,
      dropCachePatterns,
      needLocalization,
      onlyNegatePatterns
   } = options;
   const result = [];

   result.push(
      ...moduleInfo.normalizedChangedFiles
         .map(currentRelativePath => path.join(moduleInfo.appRoot, currentRelativePath))
         .filter(filterFunction)
   );

   const failedFiles = moduleInfo.cache.getFailedFiles()
      .map(currentRelativePath => path.join(moduleInfo.path, currentRelativePath))
      .filter(filterFunction);

   if (failedFiles.length > 0) {
      if (!taskParameters.config.watcherRunning) {
         logger.debug(`module "${moduleInfo.name}" has failed files from previous build:  ${JSON.stringify(failedFiles, null, 3)}`);
      }
   }

   result.push(...failedFiles);

   if (needLocalization) {
      // пересобираем локализацию только если в сборке по изменениям есть удалённые файлы локализации
      // в данной ситуации нам нужно заново проиндексировать все словари и сгенерировать выхлоп для
      // contents.
      if (taskParameters.config.localizations.length > 0 && moduleInfo.dropLocalizationCache) {
         result.push(path.join(moduleInfo.path, '/**/lang/**/*.*'));
      }
   }

   if (dropCachePatterns) {
      result.push(
         ...getInputForDropCacheCases(taskParameters, moduleInfo)
      );
   }

   if (additionalPatterns) {
      result.push(
         ...additionalPatterns
      );
   }

   // если по итогу изменений нет, нам нужно прокинуть хотя бы паттерн пустышку,
   // иначе gulp.src упадёт с ошибкой о кривом glob-паттерне
   if (result.length === 0) {
      return [path.join(moduleInfo.appRoot, moduleInfo.name)];
   }

   // если мы передали только exclude-паттерны, нужно также передать хотя бы один
   // include-паттерн пустышку, иначе gulp.src свалится с ошибкой
   if (onlyNegatePatterns && result.length === additionalPatterns.length) {
      return [path.join(moduleInfo.appRoot, moduleInfo.name)];
   }

   // remove duplicates if exists
   return [...new Set(result)];
}

/**
 * get files to read for build task
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @param {Object} gulpSrcOptions - options for gulp.src function
 * @returns {*[]|(string|string)[]}
 */
function getModuleInputForBuild(taskParameters, moduleInfo, gulpSrcOptions) {
   const excludedPatterns = [
      path.join(moduleInfo.path, '/**/*.ts'),
      path.join(moduleInfo.path, '/**/*.tsx'),
      path.join(moduleInfo.path, '/**/*.js'),
      path.join(moduleInfo.path, '/**/*.es'),
      path.join(moduleInfo.path, '/**/*.json')
   ].map(toNegativeGlob);

   // get list of changed files if it was transmitted to builder config, otherwise
   // set glob pattern to read all files from source directory recursively.
   if (moduleInfo.changedFiles && !taskParameters.cache.hasIncompatibleChanges && !moduleInfo.forceRebuild) {
      const options = {
         additionalPatterns: excludedPatterns,
         dropCachePatterns: true,
         onlyNegatePatterns: true
      };
      setDefaultChangedFilesOptions(moduleInfo, gulpSrcOptions);

      if (!taskParameters.config.watcherRunning) {
         logger.debug(`build: Using only changed files list for module ${moduleInfo.name}`);
      }

      if (moduleInfo.themeChanged) {
         options.additionalPatterns.push(path.join(moduleInfo.path, '/**/theme.less'));
      }

      return getChangedFilesList(
         taskParameters,
         moduleInfo,
         () => true,
         options
      );
   }

   return [
      path.join(moduleInfo.path, '/**/*.*'),
      ...excludedPatterns
   ];
}

/**
 * get files to read  for prepare ws task
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @param {Object} gulpSrcOptions - options for gulp.src function
 * @returns {string|*[]}
 */
function getModuleInputForPrepareWS(taskParameters, moduleInfo, gulpSrcOptions) {
   // get list of changed files if it was transmitted to builder config, otherwise
   // set glob pattern to read all files from source directory recursively.
   if (moduleInfo.changedFiles && !taskParameters.cache.hasIncompatibleChanges && !moduleInfo.forceRebuild) {
      setDefaultChangedFilesOptions(moduleInfo, gulpSrcOptions);

      if (!taskParameters.config.watcherRunning) {
         logger.debug(`prepare ws: Using only changed files list for module ${moduleInfo.name}`);
      }

      return getChangedFilesList(
         taskParameters,
         moduleInfo,
         () => true,
         { dropCachePatterns: true }
      );
   }

   return path.join(moduleInfo.path, '/**/*.*');
}

/**
 * Get files to read for compile task
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @param {Object} gulpSrcOptions - options for gulp.src function
 * @returns {string[]|*[]}
 */
function getModuleInputForCompile(taskParameters, moduleInfo, gulpSrcOptions) {
   const defaultInputPatterns = [
      path.join(moduleInfo.path, '/**/*.ts'),
      path.join(moduleInfo.path, '/**/*.tsx'),
      path.join(moduleInfo.path, '/**/*.js'),
      path.join(moduleInfo.path, '/**/*.es'),
      path.join(moduleInfo.path, '/**/*.json')
   ];

   // get list of changed files if it was transmitted to builder config, otherwise
   // set glob pattern to read all files from source directory recursively.
   if (moduleInfo.changedFiles && !taskParameters.cache.hasIncompatibleChanges && !moduleInfo.forceRebuild) {
      setDefaultChangedFilesOptions(moduleInfo, gulpSrcOptions);

      if (!taskParameters.config.watcherRunning) {
         logger.debug(`compile: Using only changed files list for module ${moduleInfo.name}`);
      }

      const currentOptions = { needLocalization: true };

      // if current module has changed .meta.ts files or .meta.ts cache was dropped, we need to
      // read all meta ts to make sure this changes won't occur errors during processing meta.ts files.
      if (taskParameters.cache.dropCacheForMetatypes || moduleInfo.metaTypesChanged) {
         currentOptions.additionalPatterns = [
            path.join(moduleInfo.path, '/**/*.meta.ts')
         ];
      }

      const result = getChangedFilesList(taskParameters, moduleInfo, isSourceFile, currentOptions);

      if (taskParameters.config.changedFilesWithDependencies[moduleInfo.outputName]) {
         result.push(
            ...taskParameters.config.changedFilesWithDependencies[moduleInfo.outputName]
               .map(fileName => path.join(moduleInfo.path, getPathWithoutModuleName(fileName)))
               .filter(isSourceFile)
         );
      }

      return [...new Set(result)];
   }

   return defaultInputPatterns;
}

/**
 * generate compressed resources only for minified content and fonts.
 * @param moduleOutput
 * @returns {string[]}
 */
function getModuleInputForCompress(taskParameters, moduleInfo, moduleOutput) {
   const currentFiles = taskParameters.filesToCopy[moduleInfo.outputName];

   if (!currentFiles) {
      // если output-артефактов нет, это может означать только одно из 2-х:
      // 1) в модуле нету изменений
      // 2) модуль взят скомпилированный и готовый(актуально для локальных стендов)
      // в первом случае пропускаем работу задачи компрессии. Для второго случая нужно
      // её запустить, поскольку может возникнуть ситуация, что в указанном готовом модуле
      // может ещё не существовать архивов(это заклад на будущее, где задача компрессии будет
      // запускаться для готового скомпилированного модуля в postbuild-задаче)
      if (moduleHasNoChanges(
         moduleInfo,
         [
            moduleInfo.changedFiles && moduleInfo.changedFiles.length > 0
         ]
      )) {
         return [moduleOutput];
      }
      logger.debug(`Using default compress patterns for module ${moduleInfo.outputName}`);

      return [
         path.join(moduleOutput, '/**/*.svg'),
         path.join(moduleOutput, '/**/*.min.{js,json,css,tmpl,wml,xhtml}')
      ];
   }

   const filesToRead = [...currentFiles].filter((currentFile) => {
      if (currentFile.endsWith('.svg') || currentFile.match(MINIFIED_FILE_TO_COMPRESS)) {
         return true;
      }


      return false;
   });

   if (filesToRead.length === 0) {
      return [moduleOutput];
   }

   return filesToRead.map(currentFile => path.join(moduleOutput, currentFile));
}

/**
 * gets module input of current interface module for custom packing.
 * If module don't have any changed or deleted files, returns void pattern
 * otherwise returns pattern to read all custom package configs(.package.json files)
 * @param {TaskParameters} taskParameters - a whole parameters list for execution of build of current project
 * @param {ModuleInfo} moduleInfo - all needed information about current interface module
 * @returns {string|*[]}
 */
function getModuleInputForCustomPack(taskParameters, moduleInfo) {
   const currentChangedFiles = taskParameters.config.getFullModuleChangedFilesList(moduleInfo.outputName);
   const canBeSkipped = moduleHasNoChanges(
      moduleInfo,
      [
         taskParameters.cache && taskParameters.cache.hasIncompatibleChanges,
         taskParameters.cache && taskParameters.cache.markupCacheIsDropped(),
         moduleInfo.forceRebuild
      ]
   );

   // Interface module can be skipped if there is no changed and deleted files in it
   if (
      canBeSkipped &&
      currentChangedFiles instanceof Array &&
      currentChangedFiles.length === 0 &&
      moduleInfo.deletedFiles.length === 0
   ) {
      moduleInfo.skipCustomPack = true;

      // for this list of modules we need to read configurations anyway for correct generate of superbundle
      // but if there is no changes in any dependant module of superbundle, superbundle will not be rebuilt
      if (taskParameters.config.modulesWithStrictCustomPack.includes(moduleInfo.outputName)) {
         logger.debug(
            `There is no changed files in module ${moduleInfo.outputName}, but this module is used for superbundles. Builder will read configs but skip package build`
         );
         return path.join(moduleInfo.output, '/**/*.package.json');
      }

      logger.debug(`There is no changed files in module ${moduleInfo.outputName}. Custom pack for him will be skipped`);
      return [moduleInfo.output];
   }

   return path.join(moduleInfo.output, '/**/*.package.json');
}

module.exports = {
   getModuleInputForBuild,
   getModuleInputForCompile,
   getModuleInputForPrepareWS,
   getModuleInputForCompress,
   getModuleInputForCustomPack,
   MINIFIED_EXTENSIONS_TO_COMPRESS
};
