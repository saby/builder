/**
 * Модуль распределения зависимостей по пакетам и генерации роутинг-артефакта.
 *
 * @author Krylov M.A.
 */
'use strict';

const path = require('path');
const fs = require('fs-extra');

const Mapper = require('../struct/mapper');
const Digraph = require('../struct/digraph');

const parseDependency = require('../dependencies/rjs');
const { normalizeModule } = require('../dependencies/normalize');
const transliterate = require('../transliterate');
const { getPrettyPath } = require('../modulepath-to-require');

const Package = require('./package');
const { createAllocateOptions } = require('./options');

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_MAP = Object.freeze(new Map());
const MODULE_PARAM = Object.freeze(new Set(['require', 'module', 'exports']));

async function withJsonFile(filePath, callback) {
   if (!(await fs.pathExists(filePath))) {
      return;
   }

   const json = await fs.readJSON(filePath);

   await callback(json);
}

function createModulesMap(modules) {
   const dict = modules.map(moduleInfo => [
      transliterate(moduleInfo.name),
      moduleInfo
   ]);

   return new Map(dict);
}

class Generator {
   constructor(modules) {
      this.modulesMap = createModulesMap(modules);

      this.files = new Map();
      this.graph = new Digraph(new Mapper());
      this.packedModules = new Map();

      this.layouts = new Map();
      this.contents = new Map();
      this.ambiguousPages = new Set();

      this.diagnosticMessages = [];
   }

   loadModules(baseDir) {
      const modules = Array.from(this.modulesMap.values());
      const handler = this._loadModuleArtifacts.bind(this, baseDir);

      return Promise.allSettled(modules.map(handler));
   }

   loadLayouts(layouts) {
      for (const name in layouts) {
         if (layouts.hasOwnProperty(name)) {
            const input = this._createModulesFromDependencies(layouts[name], (unknownModuleName) => {
               this.diagnosticMessages.push({
                  kind: 'error',
                  message: `Граф не содержит зависимость ${unknownModuleName} для раскладки ${name}`
               });
            });

            this.layouts.set(name, {
               input
            });
         }
      }
   }

   loadPages(filePath, pages) {
      for (const pageInfo of pages) {
         if (this.contents.has(pageInfo.id)) {
            this.diagnosticMessages.push({
               kind: 'error',
               message: `Обнаружены страницы с дублирующим id "${pageInfo.id}". Все страницы с таким id будут исключены из обработки`
            });

            this.ambiguousPages.add(pageInfo.id);
            this.contents.delete(pageInfo.id);

            continue;
         }

         if (this.ambiguousPages.has(pageInfo.id)) {
            continue;
         }

         if (!this.layouts.has(pageInfo.type)) {
            this.diagnosticMessages.push({
               kind: 'error',
               message: `Страница с id "${pageInfo.id}" имеет неизвестный параметр type "${pageInfo.type}"`
            });
         }

         const input = this._createModulesFromDependencies(pageInfo.modules, (moduleName) => {
            this.diagnosticMessages.push({
               kind: 'error',
               message: `Граф не содержит зависимость ${moduleName}, которая используется на странице ${pageInfo.id}`
            });
         });

         this.contents.set(pageInfo.id, {
            sourceFile: filePath,
            layout: pageInfo.type,
            input
         });
      }
   }

   allocate(uOptions) {
      const options = createAllocateOptions(uOptions);

      const layouts = this._createPackages(this.layouts, options.layout, EMPTY_MAP);
      const contents = this._createPackages(this.contents, options.content, layouts.cache);

      return {
         layouts,
         contents
      };
   }

   addLibraryFile(libraryName, packedModules) {
      if (Array.isArray(packedModules)) {
         packedModules.forEach((moduleName) => {
            this.packedModules.set(moduleName, libraryName);
         });
      }
   }

   addJsFile(filePath, moduleName, dependencies) {
      this._putModule(moduleName, dependencies);

      this.files.set(moduleName, filePath);
   }

   addJsonFile(filePath) {
      const prettyFilePath = transliterate(getPrettyPath(filePath));
      const moduleName = `json!${prettyFilePath}`;

      this._putModule(moduleName, EMPTY_ARRAY);

      this.files.set(moduleName, filePath);
   }

   addCssFile(filePath) {
      const prettyFilePath = transliterate(getPrettyPath(filePath));
      const moduleName = `css!${prettyFilePath.replace(/\.(less|css)$/gi, '')}`;

      this._putModule(moduleName, EMPTY_ARRAY);

      this.files.set(moduleName, filePath);
   }

   async _loadModuleArtifacts(baseDir, moduleInfo) {
      const componentsArtifactPath = path.join(moduleInfo.path, '.cache', 'components-info.json');

      await withJsonFile(componentsArtifactPath, (json) => {
         this._loadComponentDependencies(json);
         this._loadMarkupDependencies(json);
      });

      const inputFilesArtifactPath = path.join(moduleInfo.path, '.cache', 'input-paths.json');

      await withJsonFile(inputFilesArtifactPath, (json) => {
         this._loadInputFiles(json);
      });
   }

   _createModulesFromDependencies(dependencies, onUnknownModuleHandler) {
      return dependencies.map((dependency) => {
         const moduleName = dependency.split(':').shift();

         if (!this.graph.has(moduleName)) {
            onUnknownModuleHandler(moduleName);
         }

         return moduleName;
      });
   }

   _createPackages(collection, options, excluded) {
      const packages = new Map();
      const cache = new Map();
      const contents = new Map();
      const requiredCommon = new Set(options.requiredCommon);
      const total = collection.size;

      const common = new Package();

      const incrementCache = (key) => {
         if (!cache.has(key)) {
            cache.set(key, 0);
         }

         cache.set(key, cache.get(key) + 1);
      };

      collection.forEach((value, name) => {
         const modulesSet = this._getDeepModules(value.input);

         modulesSet.forEach((moduleName) => {
            if (excluded.has(moduleName)) {
               modulesSet.delete(moduleName);

               return;
            }

            if (this.packedModules.has(moduleName)) {
               const libraryName = this.packedModules.get(moduleName);

               incrementCache(libraryName);

               modulesSet.add(libraryName);
               modulesSet.delete(moduleName);

               return;
            }

            incrementCache(moduleName);
         });

         contents.set(name, modulesSet);
      });

      contents.forEach((value, key) => {
         if (value.size === 0) {
            return;
         }

         const cPackage = new Package();

         value.forEach((moduleName) => {
            if ((cache.get(moduleName) / total) >= options.quota || requiredCommon.has(moduleName)) {
               common.add(moduleName);

               return;
            }

            cPackage.add(moduleName);
         });

         packages.set(key, cPackage);
      });

      return {
         packages,
         common,
         cache
      };
   }

   _getDeepModules(input) {
      const array = [];

      input.forEach(moduleName => array.push(moduleName, ...this.graph.getDeep(moduleName)));

      return new Set(array);
   }

   _loadComponentDependencies(json) {
      if (json.hasOwnProperty('componentsInfo')) {
         for (const fPath in json.componentsInfo) {
            if (json.componentsInfo.hasOwnProperty(fPath)) {
               const componentsInfoElement = json.componentsInfo[fPath];

               if (!componentsInfoElement.hasOwnProperty('componentName')) {
                  continue;
               }

               if (componentsInfoElement.hasOwnProperty('libraryName')) {
                  this.addLibraryFile(componentsInfoElement.libraryName, componentsInfoElement.packedModules);
               }

               this.addJsFile(fPath, componentsInfoElement.componentName, componentsInfoElement.componentDep);
            }
         }
      }
   }

   _loadMarkupDependencies(json) {
      if (json.hasOwnProperty('markupCache')) {
         for (const fPath in json.markupCache) {
            if (json.markupCache.hasOwnProperty(fPath)) {
               const markupCacheElement = json.markupCache[fPath];

               this.addJsFile(fPath, markupCacheElement.nodeName, markupCacheElement.dependencies);
            }
         }
      }
   }

   _loadInputFiles(json) {
      for (const filePath in json.paths) {
         if (json.paths.hasOwnProperty(filePath)) {
            if (filePath.endsWith('.json')) {
               this.addJsonFile(filePath);

               continue;
            }

            if (filePath.endsWith('.less') || filePath.endsWith('.css')) {
               if (json.paths[filePath].output.some(f => f.endsWith('.css'))) {
                  this.addCssFile(filePath);
               }
            }
         }
      }
   }

   fillMissingModules() {
      const lost = this.graph.testLostVertexes();

      for (const [rawModule, sources] of lost) {
         this.graph.put(rawModule, EMPTY_ARRAY);

         const module = parseDependency(rawModule);

         if (module.hasPlugin('cdn') || module.name.startsWith('/cdn/')) {
            continue;
         }

         if (module.hasPlugin('i18n') || module.hasPlugin('datasource')) {
            continue;
         }

         this.diagnosticMessages.push({
            kind: 'debug',
            message: `Обнаружена неизвестная зависимость ${rawModule}, используемая в файлах: ${sources.join(', ')}`
         });
      }
   }

   _putModule(moduleName, dependencies) {
      const children = [];

      if (Array.isArray(dependencies)) {
         for (const dependency of dependencies) {
            if (MODULE_PARAM.has(dependency)) {
               continue;
            }

            const target = parseDependency(dependency);

            children.push(normalizeModule(target).raw);
         }
      }

      try {
         this.graph.put(moduleName, children);
      } catch (error) {
         this.diagnosticMessages.push({
            kind: 'debug',
            message: `Ошибка при добавлении зависимости "${moduleName}" в граф: ${error.message}`
         });
      }
   }
}

module.exports = Generator;
