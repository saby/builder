/**
 * @author Krylov M.A.
 */

'use strict';

const { Syntax } = require('espree');

function moveCallbackToDependencies(meta) {
   meta.dependenciesCallback = meta.factory;
   meta.dependenciesCallbackIndex = meta.factoryIndex;

   delete meta.factory;
   delete meta.factoryIndex;
}

function processModuleName(index, arg, meta) {
   // Process module name (optional)
   if (index > 0) {
      meta.errorMessage = `Expected literal passed on the 1st position in define function but got it on ${index + 1} position`;
      return true;
   }

   meta.moduleName = arg.value;
   return false;
}

function processDependencies(index, arg, meta) {
   // Process dependencies (optional)
   if (index > 1) {
      meta.errorMessage = `Expected dependencies array passed on 1st or 2nd position but got it passed on ${index + 1} position`;
      return true;
   }

   if (meta.dependencies) {
      meta.errorMessage = `Dependencies array has been already passed, got it on ${index + 1} position`;
      return true;
   }

   if (arg.elements.some(n => n.type !== Syntax.Literal)) {
      if (meta.factory) {
         const brokenType = arg.elements.find(n => n.type !== Syntax.Literal);
         meta.errorMessage = `Expected array of literals passed as dependencies but got ${brokenType.type} type in dependencies on ${index + 1} position`;
         return true;
      }

      meta.factory = arg;
      meta.factoryIndex = index;
      return false;
   }

   meta.dependencies = arg.elements.map(n => n.value);
   return false;
}

function processFactoryCallback(index, arg, meta) {
   // Process callback (required)
   if (index > 2) {
      meta.errorMessage = `Expected callback function passed 1st, 2nd or 3rd position in define but got it on ${index + 1} position`;
      return true;
   }

   if (meta.factory && [Syntax.CallExpression, Syntax.ArrayExpression].includes(meta.factory.type)) {
      if (meta.dependenciesCallback || meta.dependencies) {
         meta.errorMessage = 'Ambiguous call expressions, cannot detect dependencies and callback parameters';
         return true;
      }

      moveCallbackToDependencies(meta);
   }

   if (meta.factory) {
      meta.errorMessage = `Expected callback function has been already passed, got it on ${index + 1} position`;
      return true;
   }

   meta.factory = arg;
   meta.factoryIndex = index;
   return false;
}

function processUnknownCallback(index, arg, meta) {
   // Not commonly used case but it must be supported:
   // - dependencies parameter might look like (function(){ return ["dep1", "dep2"]; })()
   // - callback parameter might look like (function(){ /* body */ })()
   // At first process call expression as it's callback function because callback is required parameter.
   // In case of second call expression do swap: processed node was dependencies, current is callback.

   // Inside call expression only expect (arrow) function expression
   if (![Syntax.FunctionExpression, Syntax.ArrowFunctionExpression].includes(arg.callee.type)) {
      meta.errorMessage = `Expected function call expression but got ${arg.callee.type} passed on ${index + 1} position`;
      return true;
   }

   if (meta.factory) {
      if (meta.dependenciesCallback || meta.dependencies) {
         meta.errorMessage = 'Ambiguous call expressions, cannot detect dependencies and callback parameters';
         return true;
      }

      moveCallbackToDependencies(meta);
   }

   // Process callback (required) node
   if (!meta.factory && index <= 2) {
      meta.factory = arg;
      meta.factoryIndex = index;
      return false;
   }

   meta.errorMessage = 'Ambiguous call expressions, cannot detect dependencies and callback parameters';
   return true;
}

function parseDefineArguments(args, storage, hasFactoryIdentifier = false) {
   storage.hasError = true;

   for (let index = 0; index < args.length; ++index) {
      const arg = args[index];

      switch (arg.type) {
         case Syntax.Literal:
            if (processModuleName(index, arg, storage)) {
               return storage;
            }
            break;

         case Syntax.ArrayExpression:
            if (processDependencies(index, arg, storage)) {
               return storage;
            }
            break;

         case Syntax.FunctionExpression:
         case Syntax.ArrowFunctionExpression:
            if (processFactoryCallback(index, arg, storage)) {
               return storage;
            }
            break;

         case Syntax.CallExpression:
            if (processUnknownCallback(index, arg, storage)) {
               return storage;
            }
            break;

         default:
            if (arg.type === Syntax.Identifier && hasFactoryIdentifier) {
               if (processFactoryCallback(index, arg, storage)) {
                  return storage;
               }
               break;
            }

            // In case of argument with unexpected type
            storage.errorMessage = `Expected define([module_name, ] [array_of_dependencies, ] callback_function) but got ${arg.type} passed on ${index + 1} position`;
            return storage;
      }
   }

   storage.hasError = false;

   if (hasFactoryIdentifier) {
      delete storage.factory;
   }

   return storage;
}

module.exports = parseDefineArguments;
