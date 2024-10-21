/**
 * Подключение ws для gulp. Использовать ТОЛЬКО в пуле воркеров.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../lib/platform/path');
const requireJS = require('saby-units/lib/requirejs/r'),
   logger = require('../../lib/logger').logger();

const formatMessage = function(message) {
   if (typeof message === 'string') {
      return message;
   }
   return JSON.stringify(message);
};

const createMessage = function(label, tag, msg) {
   const parts = [label];

   if (tag) {
      parts.push(formatMessage(tag));
   }
   if (msg) {
      parts.push(formatMessage(msg));
   }

   return parts.join('::');
};

const getError = function(...args) {
   for (let i = 0; i < args.length; ++i) {
      if (args[i] instanceof Error) {
         return args[i];
      }
   }
   return undefined;
};

const wsLogger = {
   error(tag, msg, err) {
      // В 21.5100 продолжим выводить как предупреждение, потому что есть проблемы с шаблонами.
      logger.warning({
         error: getError(tag, msg, err),
         message: createMessage('WS error', tag, msg)
      });
   },
   warn(tag, msg, err) {
      logger.warning({
         error: getError(tag, msg, err),
         message: createMessage('WS warning', tag, msg)
      });
   },
   info(tag, msg) {
      logger.info(createMessage('WS', tag, msg));
   },
   log(tag, msg) {
      logger.debug(createMessage('WS', tag, msg));
   }
};

function initWs(requiredModules, contents) {
   return new Promise((resolve) => {
      if (!process.env['ws-init-number']) {
         process.env['ws-init-number'] = 0;
      }

      // создаём асинхронную очередь с разницей в секунду, чтобы все доступные воркеры
      // не пытались одновременно в параллель запрашивать ядро платформы, поскольку может возникнуть
      // ситуация, что пока один воркер запрашивает ядро, второй в этот момент получит от
      // require пустой обьект, поскольку эти ресурсы в данный момент читаются в первом воркере
      setTimeout(() => {
         if (!process.env['init-ws-busy']) {
            process.env['init-ws-busy'] = true;
            const applicationRoot = process.env['application-root'];

            global.wsConfig = {
               appRoot: applicationRoot,
               wsRoot: path.join(applicationRoot, '/WS.Core'),
               resourceRoot: applicationRoot,
               IS_BUILDER: true,
               RESOURCES_PATH: process.env['resources-path'] || '/'
            };
            global.wsBindings = {
               ITransport() {
                  const e = new Error();
                  throw new Error(`ITransport is not implemented in build environment.${e.stack}`);
               },
               ILogger() {
                  return wsLogger;
               }
            };
            global.rk = function rk(key) {
               let resultKey = key;
               const index = resultKey.indexOf('@@');
               if (index > -1) {
                  resultKey = resultKey.substr(index + '@@'.length);
               }
               return resultKey;
            };

            // set baseUrl to get AMD-based config of RequireJsLoader
            global.requirejs = requireJS.config({
               baseUrl: applicationRoot
            });
            global.define = requireJS.define;

            if (contents) {
               global.contents = contents;
            }

            const requireJSConfig = global.requirejs('RequireJsLoader/config');

            // apply RequireJsLoader/config for current requirejs from saby-units
            requireJSConfig.applyConfig(requireJS, global.wsConfig);

            // set configured requirejs as global for further needs
            global.requirejs = requireJS;
            const loadContents = global.requirejs('Core/load-contents');
            const modulesForAppContents = {};
            requiredModules.forEach((currentModule) => {
               modulesForAppContents[currentModule] = {
                  path: path.join(applicationRoot, currentModule)
               };
            });
            const appContents = {
               modules: modulesForAppContents
            };
            loadContents(appContents, true, { resources: '/' });

            // common core
            global.requirejs('Core/core');
            global.requirejs('Lib/core');

            /**
             * These utilities below must be downloaded immediately to make sure it'll be saved in requirejs
             * cache properly and will have correct API to work further with
             */

            // preload localization for template processor
            global.requirejs('I18n/i18n');

            // needed for xhtml localization
            global.requirejs('Core/markup/ParserUtilities');

            // needed for xhtml build
            global.requirejs('View/Compiler');

            // needed by templates processor
            global.requirejs('Application/Initializer');
            global.requirejs('Compiler/Compiler');

            delete process.env['init-ws-busy'];
            resolve(true);
         } else {
            resolve(false);
         }
      }, process.env['ws-init-number'] * 1000);
      process.env['ws-init-number']++;
   });
}

let initialized = false;
module.exports = {

   /**
    * Инициализация ядра платформы WS.
    */
   init(requiredModules, contents) {
      return new Promise((resolve, reject) => {
         const applicationRoot = process.env['application-root'];
         const timer = setInterval(doInit, 1000);
         async function doInit() {
            try {
               if (!initialized) {
                  initialized = await initWs(requiredModules, contents, applicationRoot);
                  if (initialized) {
                     clearInterval(timer);
                     resolve();
                  } else {
                     logger.debug('core init is busy, waiting another second for its availability');
                  }
               }
            } catch (e) {
               e.message = `Error occurred during core init: ${e.stack || e}`;
               reject(e);
            }
            resolve();
         }
      });
   }
};
