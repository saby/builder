/**
 * Модуль предоставляет функционал для инициализации окружения.
 *
 * ВАЖНО: окружение разрешается инициализироваться только внутри воркера!
 *
 * @author Kolbeshin F.A.
 */
'use strict';

const logger = require('../logger').logger();
const Environment = require('./environment');

function attempt(applicationRoot, resourcesPath, contents, requiredModules) {
   return new Promise((resolve) => {
      if (!process.env['ws-init-number']) {
         process.env['ws-init-number'] = 0;
      }

      function doInit() {
         if (!process.env['init-ws-busy']) {
            process.env['init-ws-busy'] = true;

            Environment.setup(
               applicationRoot,
               resourcesPath,
               contents,
               requiredModules
            );

            delete process.env['init-ws-busy'];

            resolve(true);

            return;
         }

         resolve(false);
      }

      // создаём асинхронную очередь с разницей в секунду, чтобы все доступные воркеры
      // не пытались одновременно в параллель запрашивать ядро платформы, поскольку может возникнуть
      // ситуация, что пока один воркер запрашивает ядро, второй в этот момент получит от
      // require пустой обьект, поскольку эти ресурсы в данный момент читаются в первом воркере
      setTimeout(doInit, process.env['ws-init-number'] * 1000);

      process.env['ws-init-number']++;
   });
}

let initialized = false;

function init(applicationRoot, resourcesPath, contents, requiredModules) {
   if (initialized) {
      return Promise.resolve();
   }

   return new Promise((resolve, reject) => {
      const timer = setInterval(doInit, 1000);

      async function doInit() {
         try {
            if (!initialized) {
               initialized = await attempt(
                  applicationRoot,
                  resourcesPath,
                  contents,
                  requiredModules
               );

               if (initialized) {
                  clearInterval(timer);

                  resolve();

                  return;
               }

               logger.debug('core init is busy, waiting another second for its availability');
            }
         } catch (e) {
            e.message = `Error occurred during core init: ${e.stack || e}`;
            reject(e);
         }

         resolve();
      }
   });
}

module.exports = {
   init
};
