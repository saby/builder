/* eslint-disable no-sync */
/**
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');

const logger = require('../../../../lib/logger').logger();
const { path } = require('../../../../lib/platform/path');

const DEFAULT_APPLICATION_THRESHOLD = 0.8;
const DEFAULT_LAYOUT_THRESHOLD = 0.8;
const DEFAULT_CONTENT_THRESHOLD = 0.5;

function createConfiguration(userConfig = undefined) {
   const config = {
      enabled: false,
      exclude: [],
      application: {
         common: [],
         threshold: DEFAULT_APPLICATION_THRESHOLD
      },
      layout: {
         common: [],
         threshold: DEFAULT_LAYOUT_THRESHOLD
      },
      content: {
         common: [],
         threshold: DEFAULT_CONTENT_THRESHOLD
      },
      moduleResolutions: { },
      outputPages: null
   };

   if (userConfig) {
      if (typeof userConfig.enabled === 'boolean') {
         config.enabled = userConfig.enabled;
      }

      if (Array.isArray(userConfig.exclude)) {
         config.exclude = userConfig.exclude;
      }

      if (userConfig.moduleResolutions) {
         for (const moduleName in userConfig.moduleResolutions) {
            if (userConfig.moduleResolutions.hasOwnProperty(moduleName)) {
               if (typeof userConfig.moduleResolutions[moduleName] === 'string') {
                  config.moduleResolutions[moduleName] = userConfig.moduleResolutions[moduleName];
               }
            }
         }
      }

      for (const prop of ['application', 'layout', 'content']) {
         if (userConfig[prop]) {
            if (Array.isArray(userConfig[prop].common)) {
               config[prop].common = userConfig[prop].common;
            }

            if (userConfig[prop].threshold >= 0 && userConfig[prop].threshold <= 1) {
               config[prop].threshold = userConfig[prop].threshold;
            }
         }
      }

      const hasOutputPages = (
         userConfig.hasOwnProperty('outputPages') &&
         Array.isArray(userConfig.outputPages) &&
         userConfig.outputPages.length > 0 &&
         userConfig.outputPages.every(element => typeof element === 'string')
      );

      if (hasOutputPages) {
         config.outputPages = userConfig.outputPages;
      }
   }

   return config;
}

function readConfiguration(projectModules) {
   try {
      const moduleWithConfig = projectModules
         .find(moduleInfo => moduleInfo.name === 'SabyPageLayoutPackages');

      if (!moduleWithConfig) {
         return createConfiguration();
      }

      const configFilePath = path.join(moduleWithConfig.path, 'config.json');

      if (fs.pathExistsSync(configFilePath)) {
         return createConfiguration(fs.readJsonSync(configFilePath));
      }
   } catch (error) {
      logger.debug(`Error reading SabyPageLayoutPackages/config.json: ${error.message}`);
   }

   return createConfiguration();
}

module.exports = readConfiguration;
