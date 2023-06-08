/**
 * Плагин для создания module-dependencies.json (зависимости компонентов и их расположение. для runtime паковка)
 * @author Kolbeshin F.A.
 */

'use strict';

const { path, toSafePosix, toPosix } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers'),
   transliterate = require('../../../lib/transliterate'),
   fs = require('fs-extra'),
   modulePathToRequire = require('../../../lib/modulepath-to-require');

const INTERCEPT_IGNORE = [

   /**
    * I18n interceptions cannot be solved, because those are aspects of
    * each language locale(e.g. en-GB, en-US for english) and they must be
    * packed with each one language. For this issue possible solutions are:
    * 1) use aspects as external dependencies - will cause overhead of requests for
    * each language aspect
    * 2) create a common library for these aspects - there will be overhead of transferred
    * data due to useless aspects in library.
    */
   'I18n',

   /**
    * It's a wasaby-dev-tools module and it builds by builder only in tests,
    * so there is no need in libraries intersections check
    */
   'injection'
];

const { pluginsForModuleDependencies } = require('../../../lib/builder-constants');

// плагины, которые должны попасть в links
const supportedPluginsForLinks = new Set(pluginsForModuleDependencies);

// стандартные модули, которые и так всегда есть
const excludeSystemModulesForLinks = new Set(['module', 'require', 'exports']);

// нужно добавить эти плагины, но сами зависимости добавлять в links не нужно
const pluginsOnlyDeps = new Set(['cdn', 'preload', 'remote']);

const { parsePlugins, getCssJstplAndJsonFiles, getNodePath } = require('../../../lib/moduledeps-helpers');

function toThemeModuleLessFile(dependency) {
   const [moduleName, ...filePath] = dependency.split('/');
   const fileName = `${filePath.pop()}.less`;

   return [`${moduleName}-default-theme`, ...filePath, fileName].join('/');
}

class DependencyController {
   constructor(cfg) {
      this.packedPrivateModules = {};

      this.links = {};
      this.nodes = {};
      this.packedLibraries = {};

      this.lessDependencies = {};
      this.requireJsSubstitutions = {};

      this.cfg = {
         branchTests: cfg.branchTests,
         suffix: cfg.suffix,
         resourcesUrl: cfg.resourcesUrl,
         moduleInfo: cfg.moduleInfo
      };
   }

   get data() {
      const obj = {
         links: this.links,
         nodes: this.nodes,
         packedLibraries: this.packedLibraries
      };

      if (this.cfg.branchTests) {
         obj.lessDependencies = this.lessDependencies;
         obj.requireJsSubstitutions = this.requireJsSubstitutions;
      }

      return obj;
   }

   merge(compiledMDeps) {
      Object.keys(compiledMDeps.links).forEach((currentNode) => {
         /**
          * add info from compiled meta if
          * 1) it doesn't exist yet
          * 2) it's empty
          * 3) current node is a packed library. In case of compiled sources usage
          * info about new dependencies list(after it's packed) can be extracted
          * from compiled module-dependencies meta only.
          */
         const shouldAdd = (
            !this.links.hasOwnProperty(currentNode) ||
            this.links[currentNode].length === 0 ||
            compiledMDeps.packedLibraries.hasOwnProperty(currentNode)
         );

         if (shouldAdd) {
            this.links[currentNode] = compiledMDeps.links[currentNode];
         }
      });

      Object.keys(compiledMDeps.nodes).forEach((currentNode) => {
         if (!this.nodes.hasOwnProperty(currentNode)) {
            this.nodes[currentNode] = compiledMDeps.nodes[currentNode];
         }

         if (compiledMDeps.packedLibraries.hasOwnProperty(currentNode)) {
            this.packedLibraries[currentNode] = compiledMDeps.packedLibraries[currentNode];

            this.cfg.moduleInfo.cache.storeComponentParameters(`${currentNode}.ts`, {
               packedModules: compiledMDeps.packedLibraries[currentNode],
               componentDep: compiledMDeps.links[currentNode]
            });
         }
      });
   }

   storeNode(nodeName, objectToStore, relativePath) {
      const ext = path.extname(relativePath);
      const rebasedRelativePath = this.cfg.resourcesUrl ? path.join('resources', relativePath) : relativePath;
      const prettyPath = toSafePosix(transliterate(rebasedRelativePath));

      objectToStore.path = getNodePath(prettyPath, ext, this.cfg.suffix);
      if (this.nodes[nodeName]) {
         if (objectToStore.path > this.nodes[nodeName].path) {
            this.nodes[nodeName].path = objectToStore.path;
         }
      } else {
         this.nodes[nodeName] = objectToStore;
      }

      /**
       * WS.Core interface module only has actual requirejs substitutions.
       * Store all of these for branch tests.
          */
      if (this.cfg.moduleInfo.name === 'WS.Core' && this.cfg.branchTests) {
         this.requireJsSubstitutions[`${nodeName}`] = toPosix(relativePath);
      }
   }

   addComponentsInfo(componentsInfo, globalCache) {
      for (const [relativePath, info] of Object.entries(componentsInfo)) {
         if (info.hasOwnProperty('componentName')) {
            const depsOfLink = new Set();

            if (info.hasOwnProperty('componentDep')) {
               for (const dep of info.componentDep) {
                  let skipDep = false;
                  for (const plugin of parsePlugins(dep)) {
                     if (supportedPluginsForLinks.has(plugin)) {
                        // add 'I18n/singletonI18n' as dependency instead of 'i18n',
                        // because computed links for these dependencies are same and
                        // it causes duplicate requests on a web page
                        if (plugin === 'i18n') {
                           depsOfLink.add('I18n/singletonI18n');
                        } else {
                           depsOfLink.add(plugin);
                        }
                     }

                     if (pluginsOnlyDeps.has(plugin)) {
                        skipDep = true;
                     }
                  }

                  if (!excludeSystemModulesForLinks.has(dep) && !skipDep) {
                     depsOfLink.add(dep);
                  }
               }
            }
            this.links[info.componentName] = [...depsOfLink];
            this.storeNode(info.componentName, { amd: true }, relativePath);
         }

         if (info.hasOwnProperty('libraryName')) {
            this.packedLibraries[info.libraryName] = info.packedModules;

            /**
             * Fill in private modules meta by data of this format:
             * key: private module packed into library
             * value: list of libraries that has the private module
             */
            info.packedModules.forEach((currentPrivateModule) => {
               if (!this.packedPrivateModules.hasOwnProperty(currentPrivateModule)) {
                  this.packedPrivateModules[currentPrivateModule] = [];
               }
               this.packedPrivateModules[currentPrivateModule].push(info.libraryName);
            });
         }

         if (info.hasOwnProperty('lessDependencies') && this.cfg.branchTests) {
            const result = new Set();
            info.lessDependencies.forEach((currentDependency) => {
               let currentLessDependencies = globalCache.getDependencies(
                  `${currentDependency}.less`
               );

               // css dependency in component is now dynamic(_theme option). We need to use additional search
               // of less dependencies in corresponding default theme meta to use it to get widened coverage.
               if (currentLessDependencies.length === 0) {
                  currentLessDependencies = globalCache.getDependencies(
                     toThemeModuleLessFile(currentDependency)
                  );
               }

               result.add(`css!${currentDependency}`);
               currentLessDependencies.forEach((currentLessDep) => {
                  result.add(`css!${currentLessDep.replace('.less', '')}`);
               });
            });

            this.lessDependencies[info.componentName] = Array.from(result);
         }
      }
   }

   addMarkupCache(markupCache) {
      for (const [relativePath, markupObj] of Object.entries(markupCache)) {
         if (!markupObj) {
            continue;
         }

         /**
          * There is only tmpl and wml meta information needed to be stored into
          * "links" property of "module-dependencies" meta file. Any other kind of
          * template files(old deprecated xhtml files, jstpl files) is further useless
          * in that sort of meta information.
          */
         if (markupObj.nodeName.startsWith('tmpl!') || markupObj.nodeName.startsWith('wml!')) {
            this.links[markupObj.nodeName] = markupObj.dependencies || [];
         }

         this.storeNode(markupObj.nodeName, { amd: true }, relativePath);
      }
   }

   forEachIntersection(callback) {
      // don't check for libraries interceptions in excluded modules
      if (INTERCEPT_IGNORE.includes(this.cfg.moduleInfo.name)) {
         return;
      }

      /**
       * Check libraries for interceptions between private modules.
       * current private module should be packed only in 1 library,
       * otherwise it should be declared as public dependency and be loaded as single
       * dependency in all dependent libraries
       */
      Object.keys(this.packedPrivateModules)
         .filter(key => this.packedPrivateModules[key].length > 1)
         .forEach(duplicatedKey => callback(duplicatedKey, this.packedPrivateModules));
   }

   static create(globalConfig, globalCache, moduleInfo) {
      const controller = new DependencyController({
         resourcesUrl: globalConfig.resourcesUrl,
         branchTests: globalConfig.branchTests,

         // suffix of minimization. It'll be inserted if minimize is enabled and there isn't debugCustomPack enabled.
         suffix: !globalConfig.debugCustomPack ? '.min' : '',
         moduleInfo
      });

      controller.addComponentsInfo(
         moduleInfo.cache.getComponentsInfo(), globalCache
      );

      controller.addMarkupCache(
         moduleInfo.cache.getMarkupCache()
      );

      const [cssFiles, jstplFiles, jsonFiles] = getCssJstplAndJsonFiles(
         globalCache.getInputPathsByFolder(moduleInfo.outputName)
      );

      for (const relativePath of cssFiles) {
         const prettyRelativePath = modulePathToRequire.getPrettyPath(transliterate(relativePath));
         const nodeName = `css!${prettyRelativePath.replace('.css', '')}`;
         controller.storeNode(nodeName, {}, relativePath);
      }

      for (const relativePath of jstplFiles) {
         const prettyPath = modulePathToRequire.getPrettyPath(transliterate(relativePath));
         const nodeName = `text!${prettyPath}`;
         controller.storeNode(nodeName, {}, relativePath);
      }

      for (const relativePath of jsonFiles) {
         const prettyPath = modulePathToRequire.getPrettyPath(transliterate(relativePath));
         const nodeName = `${prettyPath}`;
         controller.storeNode(nodeName, { amd: true }, `${relativePath}`);
      }

      return controller;
   }
}

function warnPackageIntersections(controller, moduleInfo) {
   controller.forEachIntersection((moduleName, packedPrivateModules) => {
      /**
       * For now, log interceptions with information level. First of all,
       * we should assess the scale of a problem in common projects.
       */
      logger.warning({
         message: (
            `Module ${moduleName} was packed into several libraries:` +
            `"${packedPrivateModules[moduleName].join('","')}"`
         ),
         moduleInfo
      });
   });
}

async function readJsonIfExists(filePath) {
   if (await fs.pathExists(filePath)) {
      return fs.readJson(filePath);
   }

   return undefined;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         callback(null, file);
      },

      /* @this Stream */
      async function onFlush(callback) {
         const startTime = Date.now();
         try {
            const controller = DependencyController.create(
               taskParameters.config,
               taskParameters.cache,
               moduleInfo
            );

            // Add missing module-dependencies meta for files when meta of those
            // can be received only if this file was compiled.
            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const filePath = path.join(
                  taskParameters.config.compiled,
                  moduleInfo.outputName,
                  'module-dependencies.json'
               );
               const oldDeps = await readJsonIfExists(filePath);

               if (oldDeps) {
                  controller.merge(oldDeps);
               }
            }

            /**
             * сохраняем мета-данные по module-dependencies по требованию.
             */
            if (taskParameters.config.dependenciesGraph) {
               const sortedMeta = JSON.stringify(helpers.sortObject(controller.data), null, 2);
               const fileName = 'module-dependencies.json';
               const jsonFile = new PosixVinyl({
                  pPath: fileName,
                  contents: Buffer.from(sortedMeta),
                  moduleInfo
               });

               moduleInfo.addFileHash(fileName, helpers.getFileHash(sortedMeta, true));
               this.push(jsonFile);
            }

            taskParameters.cache.storeLocalModuleDependencies(controller.data);

            warnPackageIntersections(controller, moduleInfo);
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }

         taskParameters.metrics.storePluginTime('presentation service meta', startTime);
         callback();
      }
   );
}

module.exports = declarePlugin;
module.exports.DependencyController = DependencyController;
