'use strict';

const { path } = require('../platform/path');
const logger = require('../logger').logger();
const toNegativeGlob = s => `!${s}`;
const MINIFIED_EXTENSIONS_TO_COMPRESS = ['js', 'json', 'css', 'tmpl', 'wml', 'xhtml'];
const MINIFIED_FILE_TO_COMPRESS = new RegExp(`.+?\\.min\\.(${MINIFIED_EXTENSIONS_TO_COMPRESS.join('|')})$`);

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

   result.push(path.join(moduleInfo.path, '/**/theme.less'));

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
   const { additionalPatterns, dropCachePatterns, needLocalization } = options;
   const result = [];

   result.push(
      ...moduleInfo.normalizedChangedFiles
         .map(currentRelativePath => path.join(moduleInfo.appRoot, currentRelativePath))
         .filter(filterFunction)
   );

   result.push(
      ...moduleInfo.cache.getFailedFiles()
         .map(currentRelativePath => path.join(moduleInfo.path, currentRelativePath))
         .filter(filterFunction)
   );

   if (needLocalization) {
      // localization is non-incremental, so we need to read it
      // to save information about dictionaries in contents
      // search for lang in all modules directory because css
      // dictionaries can be anywhere inside current interface module
      // needed to be merged into root lang css style
      if (taskParameters.config.localizations.length > 0) {
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

   // we need any pattern to pass through gulp.src function properly,
   // so we add empty string to read from a whole module directory
   if (result.length === 0) {
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
         dropCachePatterns: true
      };
      setDefaultChangedFilesOptions(moduleInfo, gulpSrcOptions);

      if (!taskParameters.config.watcherRunning) {
         logger.debug(`build: Using only changed files list for module ${moduleInfo.name}`);
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
      if (taskParameters.cache.dropCacheForMetatypes || moduleInfo.metaTsChanged) {
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
function getModuleInputForCompress(taskParameters, moduleName, moduleOutput) {
   const currentFiles = taskParameters.filesToCopy[moduleName];

   if (!currentFiles) {
      logger.debug(`Using default compress patterns for module ${moduleName}`);

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
   const canBeSkipped = moduleInfo.changedFiles &&
      !taskParameters.cache.hasIncompatibleChanges &&
      !taskParameters.cache.markupCacheIsDropped() &&
      !moduleInfo.forceRebuild;

   // Interface module can be skipped if there is no changed and deleted files in it
   if (
      canBeSkipped &&
      currentChangedFiles instanceof Array &&
      currentChangedFiles.length === 0 &&
      moduleInfo.deletedFiles.length === 0 &&
      !taskParameters.config.modulesWithStrictCustomPack.includes(moduleInfo.outputName)
   ) {
      moduleInfo.skipCustomPack = true;
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
