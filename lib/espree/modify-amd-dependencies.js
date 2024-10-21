// В данном модуле реализован метод нормализации зависимостей
// скомпилированного JS кода (разрешение относительных путей) в формате AMD.

'use strict';

const { Syntax } = require('espree');
const { traverse } = require('estraverse');
const { path, toPosix, removeLeadingSlashes } = require('../../lib/platform/path');
const modulePathToRequire = require('../../lib/modulepath-to-require');
const { parseCode } = require('./common');
const { formatError } = require('../format-error');

const privateModuleExt = /\.(ts|js)$/;
const excludeUrls = ['cdn', 'rtpackage', 'rtpack', 'demo_src'];

function isDefineFunctionNode(node) {
   return (
      node.type === Syntax.CallExpression &&
      node.callee.type === Syntax.Identifier &&
      node.callee.name === 'define'
   );
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

function normalizeModuleName(argument, moduleName, interfaceModule) {
   // requirejs names normalizing is needed only for WS.Core compiled typescript content
   if (interfaceModule === 'WS.Core') {
      return modulePathToRequire.getPrettyPath(
         toPosix(argument.value)
      );
   }

   return toPosix(moduleName);
}

function normalizeDependency(dependency, moduleName, interfaceModule) {
   let newDependency = dependency;

   if (privateModuleExt.test(newDependency) && !checkForExcludedUrl(newDependency)) {
      newDependency = newDependency.replace(privateModuleExt, '');
   }

   if (newDependency.startsWith('.')) {
      newDependency = path.join(moduleName, '..', newDependency);
   }

   /**
    * relative dependencies with plugin are not valid, for this dependencies must be selected
    * full AMD-formatted module path
    */
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

function getModuleSubstitutions(ast, sourceCode, moduleName, interfaceModule) {
   const moduleSubstitutions = [];
   let normalizedModuleName = moduleName;
   let hasModuleName;
   let argsNode;

   traverse(ast, {
      enter(node) {
         if (!isDefineFunctionNode(node)) {
            return;
         }

         argsNode = node.arguments;
         hasModuleName = false;

         node.arguments.forEach((argument, index) => {
            switch (argument.type) {
               case Syntax.Literal:
                  // ensure it's real interface module name, not Literal formatted callback
                  if (index === 0) {
                     hasModuleName = true;
                     normalizedModuleName = normalizeModuleName(argument, moduleName, interfaceModule);

                     if (argument.value !== normalizedModuleName) {
                        // Modify ast
                        argument.value = normalizedModuleName;
                        argument.raw = normalizedModuleName;

                        moduleSubstitutions.unshift({
                           name: `"${normalizedModuleName}"`,
                           start: argument.range[0],
                           end: argument.range[1],
                        });
                     }
                  }
                  break;

               case Syntax.ArrayExpression:
                  argument.elements.forEach((element) => {
                     const normalized = normalizeDependency(element.value, moduleName, interfaceModule);

                     if (element.value !== normalized) {
                        // Modify ast
                        element.value = normalized;

                        moduleSubstitutions.push({
                           name: `"${toPosix(normalized)}"`,
                           start: element.range[0],
                           end: element.range[1]
                        });
                     }
                  });
                  break;

               default:
                  break;
            }
         });

         this.break();
      }
   });

   if (!hasModuleName && argsNode) {
      const moduleNameValue = normalizeModuleName({ value: moduleName }, moduleName, interfaceModule);

      moduleSubstitutions.unshift({
         name: `"${moduleNameValue}",`,
         start: argsNode[0].range[0],
         end: argsNode[0].range[0]
      });

      // Modify ast
      argsNode.unshift({
         type: Syntax.Literal,
         value: moduleNameValue,
         raw: `"${moduleNameValue}"`
      });
   }

   return {
      moduleSubstitutions,
      normalizedModuleName
   };
}

/**
 * Normalize module dependencies.
 * TypeScript transpiler generates module dependencies with relative paths.
 *
 * Provided program modifies in this function.
 *
 * @param {string} sourceCode Source text.
 * @param {string} moduleName Module name.
 * @param {string} interfaceModule Interface module name.
 * @returns {object} Returns object - result of normalization.
 */
function normalizeDependencies(sourceCode, moduleName, interfaceModule) {
   const message = 'An error occurred while parsing compiled js file';
   const ast = parseCode(sourceCode);

   try {
      const {
         moduleSubstitutions,
         normalizedModuleName
      } = getModuleSubstitutions(ast, sourceCode, moduleName, interfaceModule);

      if (moduleSubstitutions.length === 0) {
         return {
            text: sourceCode,
            moduleName: normalizedModuleName
         };
      }

      /**
       * if we have dependencies to be replaced, just build result code with this dependencies
       * using simple string concat, without AST code generators. Reason - AST code
       * generator loses typescript comments, or in 1 working case duplicates them.
       */
      let resultSource = sourceCode.slice(0, moduleSubstitutions[0].start);

      for (let i = 0; i < moduleSubstitutions.length; i++) {
         resultSource += moduleSubstitutions[i].name;

         resultSource += sourceCode.slice(
            moduleSubstitutions[i].end,
            (moduleSubstitutions[i + 1] && moduleSubstitutions[i + 1].start) || ''
         );
      }

      resultSource += sourceCode.slice(moduleSubstitutions[moduleSubstitutions.length - 1].end, sourceCode.length);

      return {
         text: resultSource,
         moduleName: normalizedModuleName
      };
   } catch (error) {
      throw Object.assign(new Error(), {
         message: formatError({
            title: message,
            sourceText: sourceCode,
            error
         }),
         stack: null
      });
   }
}

module.exports = normalizeDependencies;
