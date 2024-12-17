/**
 * Модуль, предназначенный для работы с зависимостями RequireJS.
 *
 * @author Krylov M.A.
 */
'use strict';

function createPluginsMap(plugins) {
   return new Map(plugins.map(({ name, arg }, index) => ([name, { index, arg }])));
}

function compilePlugins(plugins) {
   return Array.from(plugins)
      .map(([name, { index, arg }]) => ({ name, index, arg }))
      .sort((a, b) => Math.sign(a.index - b.index))
      .map(plugin => (typeof plugin.arg === 'string' ? `${plugin.name}!${plugin.arg}?` : `${plugin.name}!`))
      .join('');
}

class RequireJSModule {
   constructor(name, plugins = []) {
      this.name = name;
      this.plugins = createPluginsMap(plugins);
   }

   get raw() {
      return `${compilePlugins(this.plugins)}${this.name}`;
   }

   get uiName() {
      return this.name.split('/').shift();
   }

   clone() {
      return parse(this.raw);
   }

   addPlugin(name, arg) {
      if (this.plugins.has(name)) {
         this.plugins.set(name, {
            ...this.plugins.get(name),
            arg
         });

         return;
      }

      this.plugins.set(name, {
         index: this.plugins.size,
         arg
      });
   }

   hasPlugin(name) {
      return this.plugins.has(name);
   }

   deletePlugin(name) {
      return this.plugins.delete(name);
   }
}

function parse(rawName) {
   const pluginRe = /^(([^!]+)!(([^!?]+)\?)?)/;
   const plugins = [];

   let module = rawName;
   let result = pluginRe.exec(module);

   while (result !== null) {
      const name = result[2];
      const arg = result[4];

      plugins.push({ name, arg });

      module = module.slice(result[0].length);
      result = pluginRe.exec(module);
   }

   return new RequireJSModule(module, plugins);
}

module.exports = parse;
