/* eslint-disable max-classes-per-file */
'use strict';

const { requireJsSubstitutions } = require('./builder-constants');

class RJsPlugin {
   constructor(name, feature) {
      this.name = name;
      this.feature = feature;
   }

   toString() {
      if (this.feature) {
         return `${this.name}!${this.feature}?`;
      }

      return `${this.name}!`;
   }
}

class RJsModuleName {
   constructor(plugins, moduleName) {
      this._plugins = plugins.map(({ name, feature }) => new RJsPlugin(name, feature));
      this._moduleName = RJsModuleName.normalizeModuleName(moduleName);
   }

   get name() {
      return this._moduleName;
   }

   get raw() {
      return this._plugins.reduce((head, plugin) => head + plugin.toString(), '') + this._moduleName;
   }

   hasPlugin(name) {
      return this._plugins.some(plugin => plugin.name === name);
   }

   static from(rawValue) {
      const plugins = [];
      const regex = /^(\w+)!(([^?!]+)\?)?/i;

      let moduleName = rawValue;

      while (regex.test(moduleName)) {
         const groups = regex.exec(moduleName);
         plugins.push({ name: groups[1], feature: groups[3] });

         moduleName = moduleName.replace(regex, '');
      }

      return new RJsModuleName(plugins, moduleName);
   }

   static normalizeModuleName(moduleName) {
      const sep = '/';
      const parts = moduleName.split(sep);

      for (let i = 1; i <= parts.length; i++) {
         const key = parts.slice(0, i).join(sep);

         if (!requireJsSubstitutions.has(key)) {
            continue;
         }

         return [
            requireJsSubstitutions.get(key),
            ...parts.slice(i)
         ].filter(v => !!v).join(sep);
      }

      return moduleName;
   }
}

module.exports = RJsModuleName;
