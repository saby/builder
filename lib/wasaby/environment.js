/**
 * Модуль выполняет подготовку окружения.
 *
 * @author Kolbeshin F.A.
 */
'use strict';

const requireJS = require('saby-units/lib/requirejs/r');
const { path } = require('../platform/path');
const logger = require('./logger');

function setup(applicationRoot, resourcesPath, contents, requiredModules) {
   global.wsConfig = {
      appRoot: applicationRoot,
      wsRoot: path.join(applicationRoot, '/WS.Core'),
      resourceRoot: applicationRoot,
      IS_BUILDER: true,
      RESOURCES_PATH: resourcesPath || '/'
   };

   global.wsBindings = {
      ITransport() {
         const e = new Error();
         throw new Error(`ITransport is not implemented in build environment.${e.stack}`);
      },
      ILogger() {
         return logger;
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
   const modulesForAppContents = { };
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
}

module.exports = {
   setup
};
