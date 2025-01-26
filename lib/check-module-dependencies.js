/**
 * Checks module's dependencies for existing in module-dependencies nodes and output directory
 * @author Kolbeshin F.A.
 */

'use strict';

const { pluginsRegex } = require('./builder-constants');
const fs = require('fs-extra');
const pMap = require('p-map');
const { path, removeLeadingSlashes } = require('./platform/path');
const logger = require('./logger').logger();
const helpers = require('./helpers');
const modulePathToRequire = require('./modulepath-to-require');

function checkDependencyForExcludeRules(projectModulesNames, currentModuleLink, normalizedModuleName) {
   // ignore not existing dependency if optional plugin included
   if (currentModuleLink.includes('optional!')) {
      return true;
   }

   // i18n! modules don't have nodes in module-dependencies tree
   if (currentModuleLink.includes('i18n!')) {
      return true;
   }

   // cdn links should be ignored from dependencies check plugin
   if (currentModuleLink.includes('/cdn/')) {
      return true;
   }

   // css!theme? physical path calculates dynamically on a client side in depend on
   // a theme on current page. Therefore this dependencies should be ignored
   if (currentModuleLink.includes('css!theme?')) {
      return true;
   }

   const currentLinkParts = normalizedModuleName.split('/');
   if (currentLinkParts.length === 1) {
      return true;
   }
   const currentLinkModuleName = currentLinkParts.shift();

   /**
    * ignore non-project dependencies(third-party libraries)
    * and dependencies from external interface modules
    */
   return !projectModulesNames.includes(currentLinkModuleName);
}

function getModuleInfoForCurrentNode(nodeName, modules) {
   const nodeNameWithoutPlugin = nodeName.split(pluginsRegex).pop();
   const normalizedNodeName = modulePathToRequire.normalizeModuleName(nodeNameWithoutPlugin);
   const currentModuleName = normalizedNodeName.split('/').shift();
   return modules.find(currentModuleInfo => path.basename(currentModuleInfo.path) === currentModuleName);
}

function getModuleNameWithPlugin(plugin, moduleName) {
   if (plugin) {
      return `${plugin}!${moduleName}`;
   }
   return moduleName;
}

async function isValidDependency(projectModulesNames, moduleDeps, currentModuleLink, config) {
   const outputDirectory = config.rawConfig.output;
   const { isReleaseMode } = config;
   const moduleNameWithoutPlugins = currentModuleLink.split(pluginsRegex).pop();
   const currentNodePlugin = helpers.getCurrentNodePlugin(currentModuleLink);
   const moduleNameWithPlugin = getModuleNameWithPlugin(currentNodePlugin, moduleNameWithoutPlugins);

   // check for existing node
   if (moduleDeps.nodes.hasOwnProperty(moduleNameWithPlugin)) {
      return true;
   }
   const normalizedNameWithoutPlugin = modulePathToRequire.normalizeModuleName(moduleNameWithoutPlugins);

   const ignoreDependencyByExcludeRules = checkDependencyForExcludeRules(
      projectModulesNames,
      currentModuleLink,
      removeLeadingSlashes(normalizedNameWithoutPlugin)
   );

   if (ignoreDependencyByExcludeRules) {
      return true;
   }

   let pathToCheck;

   // modules with text! plugin are already have extension
   if (currentNodePlugin === 'text') {
      pathToCheck = path.join(outputDirectory, normalizedNameWithoutPlugin);
   } else {
      let normalizedPluginName;
      if (currentNodePlugin === 'html') {
         normalizedPluginName = 'xhtml';
      } else {
         normalizedPluginName = currentNodePlugin;
      }
      pathToCheck = path.join(
         outputDirectory,
         `${normalizedNameWithoutPlugin}${isReleaseMode ? '.min' : ''}.${normalizedPluginName || 'js'}`
      );
   }
   const fileExistsInOutputDirectory = await fs.pathExists(pathToCheck);
   return fileExistsInOutputDirectory;
}

async function checkModuleDependenciesExisting(taskParameters) {
   const moduleDeps = taskParameters.cache.getModuleDependencies();
   const projectModulesNames = taskParameters.config.modules.map(
      moduleInfo => path.basename(moduleInfo.output)
   );
   await pMap(
      Object.entries(moduleDeps.links),
      async(currentEntry) => {
         const [analizingNodeName, currentNodeLinks] = currentEntry;
         const moduleInfo = getModuleInfoForCurrentNode(analizingNodeName, taskParameters.config.modules);

         // moduleInfo is undefined for third-party libraries and Core nodes, such as Deprecated, Lib, etc.
         if (!moduleInfo) {
            return;
         }
         await pMap(
            currentNodeLinks,
            async(currentModuleLink) => {
               const validDependency = await isValidDependency(
                  projectModulesNames,
                  moduleDeps,
                  currentModuleLink,
                  taskParameters.config
               );
               if (!validDependency) {
                  const message = `Error analizing dependencies: file for dependency "${currentModuleLink}" ` +
                     'doesn\'t exists in module-dependencies tree or into output directory.' +
                     'Check for dependency existing, or check that it\'s an optional! module';

                  /**
                   * TODO return errors for SDK elements after fix of problem
                   * https://online.sbis.ru/opendoc.html?guid=7e358656-e377-45a8-b9ee-c13d7278eb23
                   * Log as error if selected level "error" in s3* config files for dependency checker
                   */
                  if (taskParameters.config.checkModuleDependencies === 'error') {
                     logger.error({
                        message,
                        moduleInfo,
                        filePath: analizingNodeName
                     });
                  } else {
                     logger.warning({
                        message,
                        moduleInfo,
                        filePath: analizingNodeName
                     });
                  }
               }
            },
            {
               concurrency: 50
            }
         );
      },
      {
         concurrency: 50
      }
   );
}

module.exports = {
   checkDependencyForExcludeRules,
   getModuleInfoForCurrentNode,
   isValidDependency,
   checkModuleDependenciesExisting
};
