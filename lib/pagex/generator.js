/**
 * @author Krylov M.A.
 */
'use strict';

const anyMatch = require('anymatch');

const Package = require('./package');

const EMPTY_SET = Object.freeze(new Set());

function toLayoutsMap(layoutsObject) {
   const layouts = new Map();

   for (const layout in layoutsObject) {
      if (layoutsObject.hasOwnProperty(layout)) {
         layouts.set(layout, {
            modules: layoutsObject[layout]
         });
      }
   }

   return layouts;
}

function toContentsMap(registry) {
   const contents = new Map();

   registry.forEach((id, page) => {
      contents.set(id, page);
   });

   return contents;
}

function createMatchFunction(patterns) {
   const testFile = anyMatch(
      patterns
         .filter(element => element.startsWith('file:'))
         .map(element => element.replace(/^file:/gi, ''))
   );

   const testModule = anyMatch(
      patterns
         .filter(element => element.startsWith('module:'))
         .map(element => element.replace(/^module:/gi, ''))
   );

   return (filePath, moduleName) => (testFile(filePath) || testModule(moduleName));
}

function getModulesSetWithPatterns(dependencies, patterns) {
   const set = new Set();

   if (patterns.length === 0) {
      return set;
   }

   const match = createMatchFunction(patterns);

   dependencies.forEachFile((filePath, moduleName) => {
      if (!match(filePath, moduleName)) {
         return;
      }

      // Не пакуем модули, входящие в библиотеки, - кладем сразу библиотеку.
      if (dependencies.packedModules.has(moduleName)) {
         const libraryName = dependencies.packedModules.get(moduleName);

         set.add(libraryName);

         return;
      }

      set.add(moduleName);
   });

   return set;
}

function resolveStylePath(filePath) {
   if (/\.min\.\w+$/i.test(filePath)) {
      return filePath;
   }

   if (/\.(less|css)$/i.test(filePath)) {
      return filePath.replace(/\.(less|css)$/i, '.min.css');
   }

   return filePath;
}

function resolveRtlStylePath(filePath) {
   if (/\.min\.\w+$/i.test(filePath)) {
      return filePath;
   }

   if (/\.(less|css)$/i.test(filePath)) {
      return filePath.replace(/\.(less|css)$/i, '.rtl.min.css');
   }

   return filePath;
}

function resolveScriptPath(filePath) {
   if (/\.min\.\w+$/i.test(filePath)) {
      return filePath;
   }

   if (/\.(js|tsx?)$/i.test(filePath)) {
      return filePath.replace(/\.(js|tsx?)$/, '.min.js');
   }

   if (/\.tmpl$/i.test(filePath)) {
      return filePath.replace(/\.tmpl$/, '.min.tmpl');
   }

   if (/\.wml$/i.test(filePath)) {
      return filePath.replace(/\.wml$/, '.min.wml');
   }

   if (/\.json$/i.test(filePath)) {
      return filePath.replace(/\.json$/i, '.json.min.js');
   }

   return filePath;
}

function resolveLocaleFile(filePath) {
   return filePath.replace(/\.json$/i, '.json.min.js');
}

function pruneLocalesObject(locales) {
   for (const locale in Object.keys(locales)) {
      if (locales.hasOwnProperty(locale)) {
         if (locales[locale].length === 0) {
            delete locales[locale];
         }
      }
   }
}

class Generator {
   constructor(layouts, registry, dependencies, routerPages) {
      this.layouts = toLayoutsMap(layouts);
      this.contents = toContentsMap(registry);
      this.dependencies = dependencies;
      this.routerPages = routerPages;
      this.artifact = null;
   }

   build(options) {
      this.dependencies.fillMissingModules();

      const modulesDistribution = this._createModulesDistribution(options);
      const filesDistribution = this._createFilesDistribution(modulesDistribution, options);

      return {
         modulesDistribution,
         filesDistribution
      };
   }

   _createModulesDistribution(options) {
      const includedContents = options.outputPages ? new Set(options.outputPages) : EMPTY_SET;
      const globallyExcluded = getModulesSetWithPatterns(this.dependencies, options.exclude);

      const isExcludedGloballyFn = moduleName => globallyExcluded.has(moduleName);

      // TODO: рефакторинг
      const applications = this._createPackages(this.routerPages, options.application, isExcludedGloballyFn, EMPTY_SET);

      const layoutOptions = {
         ...options.layout,
         common: Array.from(new Set([
            ...options.layout.common,
            ...Array.from(applications.common.scripts).map(module => `module:${module}`)
         ]))
      };

      const layouts = this._createPackages(this.layouts, layoutOptions, isExcludedGloballyFn, EMPTY_SET);
      const isExcludedFn = (moduleName, layoutName) => {
         if (isExcludedGloballyFn(moduleName)) {
            return true;
         }

         if (layouts.common.has(moduleName)) {
            return true;
         }

         if (!layouts.packages.has(layoutName)) {
            return false;
         }

         const layoutPackage = layouts.packages.get(layoutName);

         return layoutPackage.has(moduleName);
      };
      const contents = this._createPackages(this.contents, options.content, isExcludedFn, includedContents);

      return {
         layouts: {
            common: layouts.common,
            packages: layouts.packages
         },
         contents: {
            common: contents.common,
            packages: contents.packages
         }
      };
   }

   _buildFilesForLocales(dependenciesSet, unresolved) {
      if (dependenciesSet.size === 0) {
         return undefined;
      }

      const locales = { };

      dependenciesSet.forEach((dependency) => {
         const moduleName = dependency.split('!').pop();

         if (!this.dependencies.locales.has(moduleName)) {
            unresolved.add(moduleName);

            return;
         }

         const moduleLocales = this.dependencies.locales.get(moduleName);

         moduleLocales.forEach((element) => {
            if (!locales.hasOwnProperty(element.locale)) {
               locales[element.locale] = [];
            }

            locales[element.locale].push(resolveLocaleFile(element.filePath));
         });
      });

      pruneLocalesObject(locales);

      return Object.keys(locales).length > 0 ? locales : undefined;
   }

   _buildFilesContentsForPackage(packageInst, options, unresolved) {
      const filesMap = this.dependencies.files;

      const packageMap = {
         locales: this._buildFilesForLocales(packageInst.locales, unresolved),
         styles: [],
         stylesRtl: [],
         scripts: []
      };

      packageInst.styles.forEach((moduleName) => {
         if (options.moduleResolutions[moduleName]) {
            packageMap.styles.push(resolveStylePath(options.moduleResolutions[moduleName]));
            packageMap.stylesRtl.push(resolveRtlStylePath(options.moduleResolutions[moduleName]));

            return;
         }

         if (!filesMap.has(moduleName)) {
            unresolved.add(moduleName);

            return;
         }

         packageMap.styles.push(resolveStylePath(filesMap.get(moduleName)));
         packageMap.stylesRtl.push(resolveRtlStylePath(filesMap.get(moduleName)));
      });

      packageInst.scripts.forEach((moduleName) => {
         if (options.moduleResolutions[moduleName]) {
            packageMap.scripts.push(resolveScriptPath(options.moduleResolutions[moduleName]));

            return;
         }

         if (!filesMap.has(moduleName)) {
            unresolved.add(moduleName);

            return;
         }

         packageMap.scripts.push(resolveScriptPath(filesMap.get(moduleName)));
      });

      return packageMap;
   }

   _buildFilesContentsForPackages(packagesMap, options, unresolved) {
      const result = new Map();

      packagesMap.forEach((v, k) => result.set(k, this._buildFilesContentsForPackage(v, options, unresolved)));

      return result;
   }

   _createFilesDistribution(modulesDistribution, options) {
      const unresolved = new Set();

      return {
         unresolved,
         layouts: {
            common: this._buildFilesContentsForPackage(modulesDistribution.layouts.common, options, unresolved),
            packages: this._buildFilesContentsForPackages(modulesDistribution.layouts.packages, options, unresolved)
         },
         contents: {
            common: this._buildFilesContentsForPackage(modulesDistribution.contents.common, options, unresolved),
            packages: this._buildFilesContentsForPackages(modulesDistribution.contents.packages, options, unresolved)
         }
      };
   }

   _getWeightedModules(patterns, initValue, isExcludedModule) {
      const weightedModules = new Map();

      const startModules = Array.from(getModulesSetWithPatterns(this.dependencies, patterns));

      if (startModules.length === 0) {
         return weightedModules;
      }

      const modulesSet = this._getDeepModules(startModules);

      modulesSet.forEach((moduleName) => {
         if (isExcludedModule(moduleName)) {
            modulesSet.delete(moduleName);

            return;
         }

         if (this.dependencies.packedModules.has(moduleName)) {
            const libraryName = this.dependencies.packedModules.get(moduleName);

            weightedModules.set(libraryName, initValue);

            modulesSet.add(libraryName);
            modulesSet.delete(moduleName);

            return;
         }

         weightedModules.set(moduleName, initValue);
      });

      return weightedModules;
   }

   _createPackages(collection, options, isExcludedModule, includedContents) {
      const packages = new Map();
      const contents = new Map();
      const total = collection.size;
      const weightedModules = this._getWeightedModules(options.common, total, isExcludedModule);
      const common = Package.createWithModules(weightedModules.keys());

      const incrementModuleWeight = (moduleName) => {
         if (!weightedModules.has(moduleName)) {
            weightedModules.set(moduleName, 0);
         }

         weightedModules.set(moduleName, weightedModules.get(moduleName) + 1);
      };

      collection.forEach((value, name) => {
         const modulesSet = this._getDeepModules(value.modules);

         modulesSet.forEach((moduleName) => {
            if (isExcludedModule(moduleName, value.type)) {
               modulesSet.delete(moduleName);

               return;
            }

            if (this.dependencies.packedModules.has(moduleName)) {
               const libraryName = this.dependencies.packedModules.get(moduleName);

               incrementModuleWeight(libraryName);

               modulesSet.add(libraryName);
               modulesSet.delete(moduleName);

               return;
            }

            incrementModuleWeight(moduleName);
         });

         if (includedContents === EMPTY_SET || includedContents.has(name)) {
            contents.set(name, modulesSet);
         }
      });

      contents.forEach((value, key) => {
         if (value.size === 0) {
            return;
         }

         const cPackage = new Package();

         value.forEach((moduleName) => {
            if ((weightedModules.get(moduleName) / total) >= options.threshold) {
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
         weightedModules
      };
   }

   _getDeepModules(modules) {
      const array = [];

      modules.forEach(moduleName => array.push(moduleName, ...this.dependencies.graph.getDeep(moduleName)));

      return new Set(array);
   }
}

module.exports = Generator;
