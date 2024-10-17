'use strict';

const { Syntax } = require('espree');
const { parseCode } = require('./common');
const escodegen = require('../third-party/escodegen');
const { traverse } = require('estraverse');

const INVALID_CHARS_FOR_VARIABLE = /\/|\?|!|-|\./g;

// list of plugins, in case of which module names with plugins and without ones are actually different files.
// e.g. "wml!myFile" is "myFile.wml", when "myFile" is "myFile.js", but in the same time
// "optional!myFile" and "myFile" is a one physical file "myFile.js"
const commonFileTypePlugins = new Set(['wml', 'css', 'cdn', 'html', 'json', 'text', 'tmpl', 'wml']);

/**
 * checks whether or not moduleName has a common file type plugin
 * @param {String} moduleName - current module name
 * @returns {boolean}
 */
function isFileTypePlugin(moduleName) {
   const modulePlugin = moduleName.split('!').shift();
   return commonFileTypePlugins.has(modulePlugin);
}

/**
 * Creates a list of both external common and styles dependencies, because
 * styles have no callback after their loading and should be arranged at the
 * end of the list. Also create dependency->argument map to be used further
 * in lazy code generating for each internal module.
 * @param {Set} internalModules - list of internal modules of current package
 * @param {Set} dependencies - list of all dependencies of all internal modules of current package
 * @returns {{argumentSubstitutions: Map<any, any>, common: [], styles: []}}
 */
function getExternalDependencies(internalModules, dependencies) {
   /**
    * all external css styles should be loaded by require
    * in the end of the dependencies list because there is no
    * need to transmit any callback variable for it.
    */
   const externalDependencies = {
      all: [],
      common: [],
      styles: [],
      argumentSubstitutions: new Map()
   };
   dependencies.forEach((currentDependency) => {
      let normalizedDependencyName = isFileTypePlugin(currentDependency) ? currentDependency : currentDependency.split(/\?|!/).pop();

      // there can be some strange dependencies with nothing but plugins
      // e.g. i18n!controller?
      if (!normalizedDependencyName) {
         normalizedDependencyName = currentDependency;
      }
      const isExternalDependency = !internalModules.has(normalizedDependencyName);
      if (isExternalDependency) {
         if (currentDependency.startsWith('css!')) {
            externalDependencies.styles.push(currentDependency);

            // each module has its own exports, so it's pointless
            // to require "exports" as common external dependency
         } else if (!(normalizedDependencyName === 'exports')) {
            externalDependencies.common.push(currentDependency);
            externalDependencies.argumentSubstitutions.set(
               currentDependency,
               currentDependency.replace(INVALID_CHARS_FOR_VARIABLE, '_')
            );
         }
         externalDependencies.all.push(currentDependency);
      }

      /**
       * substitution should be set in any case(even for the same modules
       * but different plugins), because it will be useful further in closure code generation
       * e.g. for "optional!Env/Env" dependency we should transmit
       * Env_Env as a closure variable(in current example "Env/Env"
       * is an internal module, if it's external, we should transmit
       * "optional_Env_Env" as usual closure argument name)
       */
      let substitutionName;
      if (currentDependency.startsWith('css!')) {
         substitutionName = 'null';
      } else if (isExternalDependency) {
         substitutionName = currentDependency.replace(INVALID_CHARS_FOR_VARIABLE, '_');
      } else {
         substitutionName = normalizedDependencyName.replace(INVALID_CHARS_FOR_VARIABLE, '_');
      }
      externalDependencies.argumentSubstitutions.set(currentDependency, substitutionName);
   });
   return externalDependencies;
}

/**
 * Converts modules of current custom package to
 * lazy initialize scheme.
 * @param {Array} modulesContent - array of each internal module content
 * @param {String} bundleName - name of current package
 * @returns {[]}
 */
function convertModulesToBeLazy(taskParameters, modulesContent, bundleName) {
   // a whole list of dependencies of all current package members
   const packageDependenciesList = new Set();
   const internalModules = new Map();
   const resultCode = [];
   const defineBlock = [];
   const parsedModules = [];

   // first stage - parse all members of current package and get all usefull meta
   // from it(moduleName, dependencies list and factory)
   modulesContent.forEach((currentModuleContent) => {
      const currentModuleAst = parseCode(currentModuleContent);
      const currentModule = {
         dependencies: [],
         cssDependencies: []
      };
      traverse(currentModuleAst, {
         enter(node) {
            // узел непосредственно дефайна модуля
            if (node.type === Syntax.CallExpression && node.callee.type === Syntax.Identifier && node.callee.name === 'define') {
               node.arguments.forEach((argument, index) => {
                  switch (argument.type) {
                     case Syntax.ArrayExpression:
                        argument.elements.forEach((currentElement) => {
                           if (currentElement.value.startsWith('css!')) {
                              currentModule.cssDependencies.push(currentElement.value);
                           }
                           currentModule.dependencies.push(currentElement.value);
                           packageDependenciesList.add(currentElement.value);
                        });
                        break;

                     case Syntax.Literal:
                        // ensure it's real interface module name, not Literal formatted callback
                        if (index === 0) {
                           internalModules.set(argument.value, argument.value.replace(INVALID_CHARS_FOR_VARIABLE, '_'));
                           currentModule.moduleName = argument.value;
                        }
                        break;

                     case Syntax.FunctionExpression:
                        currentModule.factory = escodegen.generate(argument, {
                           format: {
                              compact: true
                           }
                        });
                        currentModule.numberOfArguments = argument.params.length;
                        break;
                     default:
                        break;
                  }
               });

               this.break();
            }
         }
      });
      if (currentModule.moduleName.startsWith('css!')) {
         defineBlock.push(currentModuleContent);
      } else {
         parsedModules.push(currentModule);
      }
   });

   const externalDependencies = getExternalDependencies(internalModules, packageDependenciesList);
   resultCode.push('(function () {var bundleExports = {};');

   // require.js requires synchronous define of each current custom package module on 1 level
   // of the package, so we can't use just require to download all external dependencies for
   // closure of the package, therefore we need to use it with define of current package name,
   // and require this package further in all custom package members to make sure that all
   // external dependencies and all internal dependencies of custom package are defined
   // and initialized properly, e.g.
   // var bundleExports = {};
   // define('current/package', [<external_dependencies>], function() {lazy modules initialization>});
   // define('module1', ['current/package'], function() {return bundleExports['module1']};
   resultCode.push(`define('${bundleName}',['${externalDependencies.common.join("','")}'],function(${externalDependencies.common.map(element => externalDependencies.argumentSubstitutions.get(element)).join(',')}) {`);

   // second stage - generate lazy initialize code for each single module of current package and after that
   // define all of them without requirejs dependencies by transmitting corresponding variable from closure into it's
   // factory
   parsedModules.forEach((currentParsedModule) => {
      const currentVariableName = internalModules.get(currentParsedModule.moduleName);
      const resultModuleCode = [];

      // internal module variable initialization
      resultModuleCode.push(`var ${currentVariableName};`);

      // argument list for closure and execution of current module factory
      const argumentsList = currentParsedModule.dependencies
         .map((currentModule) => {
            if (internalModules.has(currentModule)) {
               return `bundleExports['${currentModule}']`;
            }

            // for ts compiled files there is an exports syntax, so there
            // is a different way of exporting a result of current module
            // factory execution, than a result of classic factory.
            // Therefore, If module has an exports syntax(typescript),
            // transmit its own variable as a result of factory execution then.
            if (currentModule === 'exports') {
               return currentVariableName;
            }
            return externalDependencies.argumentSubstitutions.get(currentModule) ||
               'null';
         });

      // generate general code for lazy module initialize
      resultModuleCode.push(
         `Object.defineProperty(bundleExports, '${currentParsedModule.moduleName}', {` +
            'get: function() {' +
               `if (!${currentVariableName}) {` +
                  `${currentVariableName} = {};` +
                  `var result = ${currentParsedModule.factory}(${argumentsList});` +
                  `if (result) {${currentVariableName} = result;}` +
               '}' +
               `return ${currentVariableName};` +
            '},' +
            'enumerable: true' +
         '});'
      );
      resultCode.push(resultModuleCode.join('\n'));

      // Don't forget about define of a current module
      // to be further available via require.js
      // Also packed in a same package css dependencies should be required in
      // the define so they could be required properly.
      defineBlock.push(
         `define('${currentParsedModule.moduleName}',${currentParsedModule.cssDependencies.length > 0 ? `['${currentParsedModule.cssDependencies.join("','")}','${bundleName}'], ` : `['${bundleName}'],`} function() {` +
            `return bundleExports['${currentParsedModule.moduleName}'];` +
         '});'
      );
   });

   resultCode.push('});\n');
   resultCode.push(...defineBlock);
   resultCode.push('})();');

   return {
      externalDependencies: externalDependencies.all,
      internalModules,
      resultCode
   };
}

module.exports = {
   convertModulesToBeLazy
};
