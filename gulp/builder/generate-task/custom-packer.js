/**
 * custompack task generator
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp');
const { path, cwd } = require('../../../lib/platform/path');
const logger = require('../../../lib/logger').logger();
const DependencyGraph = require('../../../packer/lib/dependency-graph');
const collectCustomPacks = require('../plugins/collect-custom-packs');
const { getModuleInputForCustomPack } = require('../../../lib/changed-files/get-module-input');
const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const {
   saveModuleCustomPackResults,
   saveRootBundlesMeta,
   generateAllCustomPackages,
   collectAllIntersects,
   setSuperBundle
} = require('../../../lib/pack/custom-packer');
const pMap = require('p-map');
const fs = require('fs-extra');
const transliterate = require('../../../lib/transliterate');
const toPosixVinyl = require('../../common/plugins/to-posix-vinyl');

function generateSetSuperBundles(taskParameters, configs, root, modulesForPatch) {
   return function setSuperBundles() {
      return setSuperBundle(taskParameters, configs, root, modulesForPatch);
   };
}

/**
 * Генерация задачи сбора кастомных пакетов
 * @param {TaskParameters} taskParameters набор параметров Gulp - конфигурация, кэш
 * @param {Object} configs набор кастомных пакетов проекта.
 * @param {String} root корень приложения
 * @returns {Undertaker.TaskFunction}
 */
function generateCollectPackagesTasks(configs, taskParameters, root, bundlesList, modulesForPatch) {
   const tasks = taskParameters.config.modules
      .filter(moduleInfo => !(moduleInfo.compiled && typeof moduleInfo.compiled === 'boolean'))
      .map((moduleInfo) => {
         // in custom package build interface modules paths are already transliterated
         moduleInfo.depends = moduleInfo.depends.map(currentDep => transliterate(currentDep));
         return function collectPackageJson() {
            return gulp
               .src(getModuleInputForCustomPack(taskParameters, moduleInfo), {
                  dot: false,
                  nodir: true,
                  allowEmpty: true
               })
               .pipe(handlePipeException('collectPackageJson', taskParameters, moduleInfo))
               .pipe(toPosixVinyl())
               .pipe(collectCustomPacks(taskParameters, moduleInfo, root, configs, bundlesList));
         };
      });

   if (tasks.length === 0) {
      tasks.push(done => done());
   }

   return gulp.series(
      gulp.parallel(tasks),
      generateSetSuperBundles(taskParameters, configs, root, modulesForPatch)
   );
}

/**
 * Task for bundles list getter
 * @param{Set} bundlesList - full list of bundles
 * @returns {bundlesListGetter}
 */
function generateTaskForBundlesListGetter(bundlesList) {
   return async function bundlesListGetter() {
      const bundlesDirectory = path.join(cwd(), 'resources/bundles');
      const filesList = await fs.readdir(bundlesDirectory);
      await pMap(
         filesList,
         async(bundleListName) => {
            const currentPath = path.join(bundlesDirectory, bundleListName);
            try {
               const currentBundles = await fs.readJson(currentPath);
               currentBundles.forEach(currentBundle => bundlesList.add(currentBundle));
            } catch (error) {
               logger.error({
                  message: 'error reading bundles content from builder sources. Check it for syntax errors',
                  filePath: currentPath,
                  error
               });
            }
         },
         {
            concurrency: 20
         }
      );
   };
}

/**
 * Генерация задачи кастомной паковки.
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {Undertaker.TaskFunction|function(done)} В debug режиме вернёт пустышку, чтобы gulp не упал
 */
function generateTaskForCustomPack(taskParameters) {
   const isCustomPackEnabled = taskParameters.config.customPack || taskParameters.config.debugCustomPack;
   if (!isCustomPackEnabled || !taskParameters.config.isReleaseMode) {
      return function skipCustomPack(done) {
         done();
      };
   }

   const
      root = taskParameters.config.outputPath,
      depsTree = new DependencyGraph(),
      configs = {
         commonBundles: {},
         superBundles: []
      },
      results = {
         bundles: {},
         optionalBundles: {},
         bundlesRoute: {},
         superBundles: {},
         excludedCSS: {}
      },
      bundlesList = new Set();


   const modulesForPatch = taskParameters.config.getModulesForPatch()
      .map(moduleInfo => path.basename(moduleInfo.output));


   const customPack = taskParameters.metrics.createTimer('custom pack');
   return gulp.series(
      customPack.start(),
      generateDepsGraphTask(depsTree, taskParameters.cache),
      customPack.lap('get dependencies graph'),
      generateTaskForBundlesListGetter(bundlesList),
      customPack.lap('get bundles approved list'),
      generateCollectPackagesTasks(configs, taskParameters, root, bundlesList, modulesForPatch),
      customPack.lap('collect packages configs'),
      generateCustomPackageTask(configs, taskParameters, depsTree, results, root),
      customPack.lap('build packages'),
      generateInterceptCollectorTask(taskParameters, root, results),
      customPack.lap('collect intercepts'),
      generateSaveResultsTask(taskParameters, results, root, modulesForPatch),
      customPack.lap('save results'),
      customPack.finish()
   );
}

function generateCustomPackageTask(configs, taskParameters, depsTree, results, root) {
   return function custompack() {
      return generateAllCustomPackages(configs, taskParameters, depsTree, results, root);
   };
}


function generateInterceptCollectorTask(taskParameters, root, results) {
   if (taskParameters.config.sources) {
      return function collectIntercepts() {
         return collectAllIntersects(taskParameters, root, results);
      };
   }
   return function skipCollectIntersects(done) {
      done();
   };
}

function generateSaveResultsTask(taskParameters, results, applicationRoot, modulesForPatch) {
   return async function saveCustomPackerResults() {
      if (taskParameters.config.joinedMeta) {
         await saveRootBundlesMeta(taskParameters, applicationRoot, results);
      }

      await saveModuleCustomPackResults(taskParameters, results, applicationRoot, modulesForPatch);

      // Save bundles route for html.tmpl compilation
      taskParameters.cache.commonBundlesRoute = results.bundlesRoute;

      /**
       * save "module-dependencies" meta for all project into cache. Will be needed
       * in patches to get proper list of modules for custom packing.
       */
      await fs.outputJson(
         path.join(taskParameters.config.cachePath, 'module-dependencies.json'),
         taskParameters.cache.getModuleDependencies()
      );

      const moduleDependencies = taskParameters.cache.getModuleDependencies().links;
      const internalModulesCycles = taskParameters.checkLazyBundlesForCycles(moduleDependencies);
      const packagesWithInternalCycles = Object.keys(internalModulesCycles);
      if (packagesWithInternalCycles.length > 0) {
         packagesWithInternalCycles.forEach((currentBundleName) => {
            internalModulesCycles[currentBundleName].forEach((currentSequence) => {
               logger.error({
                  message: `Found a cyclic dependency from one internal module of lazy package to another: ${currentSequence.join(' --> ')}`,
                  filePath: currentBundleName
               });
            });
         });
      }

      // save module-dependencies with updated meta info about dependencies of internal modules
      // of each generated lazy bundle
      await taskParameters.cache.storeModuleDependencies();

      await taskParameters.saveLazyBundles();
      await taskParameters.saveLazyBundlesMap();
   };
}

function generateDepsGraphTask(depsTree, cache) {
   return function generateDepsGraph(done) {
      const moduleDeps = cache.getModuleDependencies(),
         currentNodes = Object.keys(moduleDeps.nodes),
         currentLinks = Object.keys(moduleDeps.links);

      if (currentLinks.length > 0) {
         currentLinks.forEach((link) => {
            depsTree.setLink(link, moduleDeps.links[link]);
         });
      }
      if (currentNodes.length > 0) {
         currentNodes.forEach((node) => {
            const currentNode = moduleDeps.nodes[node];
            currentNode.path = currentNode.path.replace(/^resources\//, '');
            depsTree.setNode(node, currentNode);
         });
      }
      done();
   };
}

module.exports = generateTaskForCustomPack;
