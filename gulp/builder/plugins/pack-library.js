/**
 * Plugin for packing of private parts of libraries.
 * Those are AMD-modules that have a pre-word symbol "_" or to be
 * located inside of directory with pre-word symbol "_" in it's
 * name.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, removeLeadingSlashes } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   libPackHelpers = require('../../../lib/pack/helpers/librarypack'),
   pMap = require('p-map'),
   execInPool = require('../../common/exec-in-pool'),
   helpers = require('../../../lib/helpers'),
   { TS_EXT } = require('../../../lib/builder-constants');

function getPrivatePartsCache(taskParameters, moduleInfo) {
   // Take templates cache, it may contain private library dependencies content.
   const markupCache = moduleInfo.cache.getMarkupCache();
   const tsCache = { ...moduleInfo.cache.getCompiledTsModuleCache() };
   const failedFiles = taskParameters.cache.getFailedFiles(moduleInfo.name).map(
      currentFile => path.relative(
         path.dirname(moduleInfo.output),
         path.resolve(moduleInfo.output, currentFile)
      )
   ).filter(currentFile => libPackHelpers.isPrivate(currentFile));
   const result = {};

   // first of all, we should add failed files from previous build.
   // If file is successfully rebuilt in current build, failed status
   // will be successfully overwritten with compiled file cache
   failedFiles.forEach((currentKey) => {
      result[currentKey] = {
         error: true,
         nodeName: currentKey.replace(path.extname(currentKey), '')
      };
   });

   Object.keys(tsCache).forEach((currentKey) => {
      result[currentKey] = tsCache[currentKey];
   });

   Object.keys(markupCache).forEach((currentKey) => {
      result[currentKey] = markupCache[currentKey];
   });

   return result;
}

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const libraries = [];
   const moduleRoot = path.dirname(moduleInfo.path);
   const { emitTypescript } = taskParameters.config;

   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         const isTsFile = emitTypescript ? file.tscEmit : TS_EXT.test(file.pHistory[0]);

         if (
            !helpers.componentCantBeParsed(file) &&
            isTsFile &&

            // Correctly get the relative path from the surface of path-ancestors of the compiling library
            !libPackHelpers.isPrivate(
               removeLeadingSlashes(file.pHistory[0].replace(moduleInfo.appRoot, ''))
            )
         ) {
            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               file.library = true;
               callback(null, file);
            } else {
               libraries.push(file);
               callback();
            }
         } else {
            callback(null, file);
         }

         taskParameters.metrics.storePluginTime('pack libraries', startTime);
      },

      /* @this Stream */
      async function onFlush(callback) {
         const componentsInfo = moduleInfo.cache.getComponentsInfo();
         await pMap(
            libraries,
            async(library) => {
               const currentComponentInfo = componentsInfo[path.relative(moduleInfo.appRoot, library.pHistory[0])];

               // ignore ts modules without private dependencies
               if (!currentComponentInfo.privateDependencies) {
                  this.push(library);
                  return;
               }
               const libraryData = library.productionContents || library.contents;
               const [error, result] = await execInPool(
                  taskParameters.pool,
                  'packLibrary',
                  [
                     {
                        generateUMD: taskParameters.config.generateUMD,
                        tsxProdCachePath: path.join(taskParameters.config.cachePath, 'tsx-production')
                     },
                     moduleInfo.appRoot,
                     path.dirname(moduleInfo.output),
                     libraryData.toString(),
                     getPrivatePartsCache(taskParameters, moduleInfo)
                  ],
                  library.pHistory[0],
                  moduleInfo
               );
               if (error) {
                  taskParameters.cache.markFileAsFailed(library.pRelativeSource(moduleInfo.path));
                  logger.error({
                     message: 'Error while packing library',
                     error,
                     filePath: library.pHistory[0],
                     moduleInfo
                  });
                  if (error.privateDependencies instanceof Array) {
                     error.privateDependencies.forEach((dependency) => {
                        taskParameters.cache.markFileAsFailed(path.relative(moduleRoot, dependency));
                     });
                  }
               } else {
                  taskParameters.metrics.storeWorkerTime('pack libraries', result.timestamp);
                  library.modulepack = result.compiled;

                  /**
                   * Builder cache information of dependencies have to be updated by
                   * corresponding result dependencies to take it into consideration
                   * when creating of module-dependencies meta file and to avoid private
                   * library dependencies to be pasted into HTML-page by VDOM server-side
                   * functionality.
                   * @type {string}
                   */
                  if (result.newModuleDependencies) {
                     moduleInfo.cache.storeComponentParameters(path.relative(moduleInfo.appRoot, library.pHistory[0]), {
                        componentDep: result.newModuleDependencies
                     });
                     moduleInfo.cache.storeComponentParameters(
                        path.relative(moduleInfo.appRoot, library.pHistory[0]).replace(/\.(ts|es)$/, '.js'),
                        {
                           componentDep: result.newModuleDependencies
                        }
                     );
                  }
                  if (result.fileDependencies && result.fileDependencies.length > 0) {
                     moduleInfo.cache.storeComponentParameters(path.relative(moduleInfo.appRoot, library.pHistory[0]), {
                        packedModules: result.packedModules,
                        libraryName: result.name
                     });
                     taskParameters.cache.addDependencies(
                        moduleInfo.appRoot,
                        library.pHistory[0],

                        // file dependencies could be with a plugin, e.g. RichEditor/extended has
                        // a dependency named "browser!RichEditor/_extended/Toolbar/Button/CodeSample/third-party/prism"
                        result.fileDependencies.map(currentDependency => currentDependency.split(/!|\?/).pop())
                     );
                  }
                  if (result.warnings) {
                     result.warnings.forEach((currentWarning) => {
                        logger.warning({
                           message: currentWarning,
                           filePath: library.pHistory[0],
                           moduleInfo
                        });
                     });
                  }
                  library.library = true;

                  /**
                   * Add packed libraries in versioned_modules and cdn_modules meta file if there are
                   * packed private dependencies with an appropriate content to be replaced further
                   * by jinnee
                   */
                  library.versioned = result.versioned;
                  library.cdnLinked = result.cdnLinked;
               }
               this.push(library);
            },
            {
               concurrency: 10
            }
         );

         callback(null);
      }
   );
};
