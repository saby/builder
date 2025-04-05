/**
 * @author Krylov M.A.
 */
'use strict';

const Mapper = require('../struct/mapper');
const Digraph = require('../struct/digraph');

const parseDependency = require('../dependencies/rjs');
const { normalizeModule } = require('../dependencies/normalize');
const transliterate = require('../transliterate');
const { getPrettyPath } = require('../modulepath-to-require');

const EMPTY_ARRAY = Object.freeze([]);
const MODULE_PARAM = Object.freeze(new Set(['require', 'module', 'exports']));
const LOCALE_RE = /^([^/]+)\/lang\/(\w{2})\/(\w{2})(-(\w{2}))?\.json$/i;

class Collector {
   constructor(modules) {
      /**
       * @type {Set<string>}
       */
      this.modules = modules;
      this.locales = new Map();
      this.files = new Map();
      this.graph = new Digraph(new Mapper());
      this.packedModules = new Map();

      /**
       * Карта опциональных зависимостей: опциональная зависимость -> пользователи
       * @type {Map<string, string[]>}
       */
      this.optionals = new Map();
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

      this._putLocale(filePath);
      this._putModule(moduleName, EMPTY_ARRAY);

      this.files.set(moduleName, filePath);
   }

   addCssFile(filePath) {
      const prettyFilePath = transliterate(getPrettyPath(filePath));
      const moduleName = `css!${prettyFilePath.replace(/\.(less|css)$/gi, '')}`;

      this._putModule(moduleName, EMPTY_ARRAY);

      this.files.set(moduleName, filePath);
   }

   fillMissingModules() {
      const lost = this.graph.testLostVertexes();

      for (const [rawModule] of lost) {
         this.graph.put(rawModule, EMPTY_ARRAY);
      }
   }

   forEachFile(callback) {
      this.files.forEach(callback);
   }

   _putModule(moduleName, dependencies) {
      const children = [];

      if (Array.isArray(dependencies)) {
         for (const dependency of dependencies) {
            if (MODULE_PARAM.has(dependency)) {
               continue;
            }

            const target = parseDependency(dependency);

            if (this._shouldIgnoreDependency(target)) {
               continue;
            }

            this._putOptional(moduleName, target);

            children.push(normalizeModule(target).raw);
         }
      }

      try {
         this.graph.put(moduleName, children);
         // eslint-disable-next-line no-empty
      } catch (error) { }
   }

   /**
    * @param {RequireJSModule} module RequireJS module.
    * @return {boolean}
    * @private
    */
   _shouldIgnoreDependency(module) {
      if (module.name.startsWith('@') || module.name.startsWith('node:')) {
         return true;
      }

      if (module.hasPlugin('cdn') || module.name.startsWith('/cdn/')) {
         return true;
      }

      return (
         module.hasPlugin('optional') &&
         !this.modules.has(module.uiName)
      );
   }

   /**
    * @param {string} parent Parent module name.
    * @param {RequireJSModule} child Child RequireJS module.
    * @private
    */
   _putOptional(parent, child) {
      if (!child.hasPlugin('optional')) {
         return;
      }

      if (!this.optionals.has(child.name)) {
         this.optionals.set(child.name, []);
      }

      this.optionals.get(child.name).push(parent);
   }

   _putLocale(filePath) {
      if (!LOCALE_RE.test(filePath)) {
         return;
      }

      const [, uiModule, locale,,, region] = LOCALE_RE.exec(filePath);

      if (!this.locales.has(uiModule)) {
         this.locales.set(uiModule, []);
      }

      this.locales.get(uiModule).push({
         filePath,
         locale,
         region
      });
   }
}

module.exports = Collector;
