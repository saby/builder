'use strict';

// простаявляем флаг isMasterPage
function prepareToSave(routesInfo) {
   for (const routesFilePath in routesInfo) {
      if (!routesInfo.hasOwnProperty(routesFilePath)) {
         continue;
      }

      const routesRules = routesInfo[routesFilePath];
      for (const url of Object.keys(routesRules)) {
         // этот флаг нужен препроцессору.
         // сервис представлений его не смотрит.
         // TODO: удалить всесте с препроцессором
         routesRules[url].isMasterPage = false;
      }
   }
}

module.exports = prepareToSave;
