/**
 * @author Krylov M.A.
 */

'use strict';

const { path, removeLeadingSlashes } = require('../../lib/platform/path');
const modulePathToRequire = require('../../lib/modulepath-to-require');
const RJsModuleName = require('../require-js');

const privateModuleExt = /\.(es|ts|js)$/;
const excludeUrls = ['cdn', 'rtpackage', 'rtpack', 'demo_src'];

const REQUIRE = 'global.requirejs';
const SPECIAL_DEPENDENCIES = ['require', 'exports', 'module'];

function genRequireModule(dependency) {
   const moduleName = RJsModuleName.from(dependency);

   if (moduleName.hasPlugin('i18n')) {
      return 'function(key) { return key; }';
   }

   return `${REQUIRE}("${dependency}")`;
}

function genRequire(dependency, creator = genRequireModule) {
   if (dependency === 'require') {
      return REQUIRE;
   }

   if (dependency === 'module') {
      return 'module';
   }

   if (dependency === 'exports') {
      return 'module.exports';
   }

   return creator(dependency);
}

function checkForExcludedUrl(dependency) {
   let result = false;
   const normalizedDependency = removeLeadingSlashes(
      dependency.split(/!|\?/).pop()
   );
   excludeUrls.forEach((currentUrl) => {
      if (normalizedDependency.startsWith(currentUrl)) {
         result = true;
      }
   });
   return result;
}

function normalizeDependency(dependency, moduleName, interfaceModule) {
   let newDependency = dependency;

   if (privateModuleExt.test(newDependency) && !checkForExcludedUrl(newDependency)) {
      newDependency = newDependency.replace(privateModuleExt, '');
   }

   if (newDependency.startsWith('.')) {
      newDependency = path.join(moduleName, '..', newDependency);
   }

   // relative dependencies with plugin are not valid, for this dependencies must be selected
   // full AMD-formatted module path
   if (newDependency.includes('!.') || newDependency.includes('?.')) {
      throw new Error(
         'relative dependencies with plugin are not valid. ' +
         `Use full amd-module-name for this case! Bad dependency name: ${newDependency}`
      );
   }

   // requirejs names normalizing is needed only for WS.Core dependencies
   if (interfaceModule === 'WS.Core') {
      newDependency = modulePathToRequire.getPrettyPath(newDependency);
   }

   return newDependency;
}

module.exports = {
   SPECIAL_DEPENDENCIES,
   REQUIRE,
   genRequire,
   genRequireModule,
   normalizeDependency
};
