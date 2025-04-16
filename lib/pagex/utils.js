/**
 * @author Krylov M.A.
 */
'use strict';

function trimModule(moduleName) {
   return moduleName.split(':').shift();
}

function toUniqueArrayElements(array) {
   return Array.from(new Set(array));
}

function prepareModules(modules) {
   return toUniqueArrayElements(modules.map(trimModule));
}

function prepareLayouts(layouts) {
   for (const layout in layouts) {
      if (layouts.hasOwnProperty(layout)) {
         layouts[layout] = prepareModules(layouts[layout]);
      }
   }
}

module.exports = {
   prepareModules,
   prepareLayouts
};
