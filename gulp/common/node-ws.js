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

function initWs(requiredModules) {
   logger.debug(`В worker передан параметр application-root=${process.env['application-root']}`);
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
   // needed for xhtml localization
   global.requirejs('Core/markup/ParserUtilities');

   // needed for xhtml build
   global.requirejs('View/Compiler');

   // needed by templates processor
   global.requirejs('Application/Initializer');
   global.requirejs('UI/Builder');
}

let initialized = false;
module.exports = {

   /**
    * Инициализация ядра платформы WS.
    */
   init(requiredModules) {
      try {
         if (!initialized) {
            initWs(requiredModules);
            initialized = true;
         }
      } catch (e) {
         e.message = `Ошибка инициализации ядра платформы WS: ${e.stack || e}`;
         throw e;
      }
   }
};
