'use strict';

/**
 * Нормализовать RequireJS зависимость.
 * Здесь удаляются все избыточные плагины, не относящиеся к типу содержимого зависимости,
 * а все JSON зависимости приводятся к формату "json!<путь>.json".
 * @param {RequireJSModule} module Зависимость.
 * @return {RequireJSModule} Возвращает зависимость, в которой отсутствуют необязательные плагины.
 */
function normalizeModule(module) {
   const nModule = module.clone();

   if (nModule.name.endsWith('.json')) {
      nModule.addPlugin('json');
   }

   if (nModule.hasPlugin('json') && !nModule.name.endsWith('.json')) {
      nModule.name = `${nModule.name}.json`;
   }

   if (nModule.hasPlugin('native-css')) {
      nModule.addPlugin('css');

      nModule.deletePlugin('native-css');
   }

   nModule.deletePlugin('browser');
   nModule.deletePlugin('is');
   nModule.deletePlugin('js');
   nModule.deletePlugin('normalize');
   nModule.deletePlugin('optional');
   nModule.deletePlugin('order');
   nModule.deletePlugin('preload');

   return nModule;
}

module.exports = {
   normalizeModule
};
