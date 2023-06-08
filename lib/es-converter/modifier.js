/**
 * @author Krylov M.A.
 */

'use strict';

const req = require('./require');
const { Syntax } = require('esprima-next');
const { traverse } = require('estraverse');
const { path } = require('../../lib/platform/path');

function isCallExpression(node, calleeName) {
   return node.type === Syntax.CallExpression &&
      node.callee.type === Syntax.Identifier &&
      node.callee.name === calleeName;
}

function resolveModuleId(id, filePath, moduleName, interfaceModule) {
   let resolved = id;

   if (id.startsWith('./') || id.startsWith('../')) {
      resolved = path.join(path.dirname(filePath), id);
   }

   return req.normalizeDependency(resolved, moduleName, interfaceModule);
}

function normalizeRequire(program, filePath, moduleName, interfaceModule) {
   const moduleSubstitutions = [];

   traverse(program, {
      enter(node) {
         if (isCallExpression(node, 'require') && node.arguments.length > 0) {
            // A place where we might require module with its relative path.
            // TODO: Typescript compiler resolves importing module paths for only define function call.
            const moduleIdNode = node.arguments[0];

            if (moduleIdNode.type === Syntax.Literal) {
               const newValue = resolveModuleId(moduleIdNode.value, filePath, moduleName, interfaceModule);

               // Modify ast
               moduleIdNode.value = newValue;

               moduleSubstitutions.push({
                  range: moduleIdNode.range,
                  value: `"${newValue}"`
               });
            }
         }
      }
   });

   return moduleSubstitutions;
}

function substitute(substitutions, source, shift) {
   // Modify original source text from the end
   substitutions.sort((a, b) => a.range[0] - b.range[0]);

   let resultSource = source;
   for (let i = substitutions.length - 1; i >= 0; --i) {
      const task = substitutions[i];

      resultSource = (
         resultSource.slice(0, task.range[0] - shift) +
         task.value +
         resultSource.slice(task.range[1] - shift)
      );
   }

   return resultSource;
}

function prepareFactoryText(factory, fullSource, filePath, moduleName, interfaceModule) {
   const shift = factory.range[0];
   const source = fullSource.slice(factory.range[0], factory.range[1]);
   const substitutions = normalizeRequire(factory, filePath, moduleName, interfaceModule);

   return substitute(substitutions, source, shift);
}

function getSourceRoundRootBlock(source, meta) {
   if (!meta.root) {
      return ['', ''];
   }

   const leadingData = source.slice(0, meta.root.range[0]);
   const trailingData = source.slice(meta.root.range[1]);

   return [leadingData, trailingData];
}

function modifyFactoryArguments(factoryArguments) {
   if (Array.isArray(factoryArguments)) {
      return factoryArguments.map(v => req.genRequire(v));
   }

   return factoryArguments;
}

function isRequireCallExpression(node) {
   return (
      node.type === Syntax.CallExpression &&
      node.callee &&
      node.callee.type === Syntax.Identifier &&
      node.callee.name === 'require' &&
      node.arguments.length === 1 &&
      node.arguments[0].type === Syntax.Literal
   );
}

function isRequireVariableDeclaration(child) {
   return (
      child.type === Syntax.VariableDeclaration &&
      child.declarations.length === 1 &&
      child.declarations[0].type === Syntax.VariableDeclarator &&
      child.declarations[0].id.type === Syntax.Identifier &&
      child.declarations[0].init &&
      isRequireCallExpression(child.declarations[0].init)
   );
}

function isRequireCall(node) {
   return (
      node.type === Syntax.ExpressionStatement &&
      isRequireCallExpression(node.expression)
   );
}

function isExportStarStatement(node) {
   return (
      node.type === Syntax.ExpressionStatement &&
      node.expression.type === Syntax.CallExpression &&
      node.expression.callee.type === Syntax.MemberExpression &&
      !node.expression.callee.computed &&
      node.expression.callee.object.type === Syntax.Identifier &&
      node.expression.callee.property.type === Syntax.Identifier &&
      node.expression.callee.property.name === '__exportStar' &&
      node.expression.arguments.length === 2 &&
      isRequireCallExpression(node.expression.arguments[0]) &&
      node.expression.arguments[1].type === Syntax.Identifier &&
      node.expression.arguments[1].name === 'exports'
   );
}

function isExportAssignment(node) {
   return (
      node.type === Syntax.ExpressionStatement &&
      node.expression.type === Syntax.AssignmentExpression &&
      node.expression.operator === '=' &&
      node.expression.left.type === Syntax.MemberExpression &&
      node.expression.left.object.type === Syntax.Identifier &&
      node.expression.left.object.name === 'exports' &&
      isRequireCallExpression(node.expression.right)
   );
}

function getTopLevelExpressions(factory) {
   if ([Syntax.FunctionExpression, Syntax.ArrowFunctionExpression].includes(factory.type)) {
      if (factory.body.type === Syntax.BlockStatement) {
         return factory.body.body;
      }
   }

   return [];
}

function stringifyFactoryParameters(factory) {
   if (!Array.isArray(factory.params)) {
      return [];
   }

   if (factory.params.every(p => p.type === Syntax.Identifier)) {
      return factory.params.map(p => p.name);
   }

   return [];
}

function parseRequireExpressions(factory, requireExpressions, dependencies) {
   const factoryParameters = stringifyFactoryParameters(factory);
   const mapping = { };

   for (let i = 0; i < requireExpressions.length; ++i) {
      if (requireExpressions[i].type !== Syntax.VariableDeclaration) {
         continue;
      }

      const identName = requireExpressions[i].declarations[0].id.name;
      const moduleName = requireExpressions[i].declarations[0].init.arguments[0].value;

      if (!mapping[moduleName]) {
         mapping[moduleName] = [];
         mapping[moduleName].inUse = true;
      }

      mapping[moduleName].push(identName);
   }

   for (let i = 0; i < dependencies.length; ++i) {
      if (mapping.hasOwnProperty(dependencies[i])) {
         continue;
      }

      if (!mapping[dependencies[i]]) {
         mapping[dependencies[i]] = [];
         mapping[dependencies[i]].inUse = false;
      }

      if (factoryParameters[i]) {
         mapping[dependencies[i]].inUse = true;
         mapping[dependencies[i]].push(factoryParameters[i]);
         continue;
      }

      mapping[dependencies[i]].push(`__dep_${i}`);
   }

   return mapping;
}

function prepareCleanFactory(factory, fullSource, dependencies) {
   const topLevelExpressions = getTopLevelExpressions(factory);
   const requireExpressions = [];
   const substitutions = [];

   topLevelExpressions.forEach((node) => {
      if (isRequireVariableDeclaration(node)) {
         requireExpressions.push(node);
         substitutions.push({
            range: node.range,
            value: ''
         });
         return;
      }

      if (isRequireCall(node)) {
         substitutions.push({
            range: node.range,
            value: ''
         });
      }
   });

   const mapping = parseRequireExpressions(factory, requireExpressions, dependencies);

   topLevelExpressions.forEach((node) => {
      if (isExportStarStatement(node)) {
         const moduleName = node.expression.arguments[0].arguments[0].value;
         const identName = mapping[moduleName];
         identName.inUse = true;

         substitutions.push({
            range: node.expression.arguments[0].range,
            value: identName[0]
         });
      }

      if (isExportAssignment(node)) {
         const moduleName = node.expression.right.arguments[0].value;
         const identName = mapping[moduleName];
         identName.inUse = true;

         substitutions.push({
            range: node.expression.right.range,
            value: identName[0]
         });
      }
   });

   const factoryParameters = [];
   const cleanDependencies = dependencies.sort((a, b) => Number(mapping[b].inUse) - Number(mapping[a].inUse));
   for (let i = 0; i < cleanDependencies.length; ++i) {
      const ids = mapping[cleanDependencies[i]];

      if (!ids.inUse) {
         break;
      }

      if (ids.length > 0) {
         factoryParameters.push(ids.shift());
         continue;
      }

      factoryParameters.push(`__unused_${i}`);
   }

   const shift = factory.range[0];
   const source = fullSource.slice(factory.range[0], factory.range[1]);

   if (factory.params.length > 0 && factoryParameters.length > 0) {
      substitutions.push({
         range: [
            factory.params[0].range[0],
            factory.params[factory.params.length - 1].range[1],
         ],
         value: factoryParameters.join(', ')
      });
   }

   const cleanFactory = substitute(substitutions, source, shift);

   return [cleanFactory, cleanDependencies];
}

function modify(program, source, meta, options) {
   const moduleNameByFilePath = options.filePath.replace(/\.(es|js|tsx?)$/, '');
   const interfaceModule = moduleNameByFilePath.split('/').shift();
   const moduleName = req.normalizeDependency(
      moduleNameByFilePath,
      moduleNameByFilePath,
      interfaceModule
   );
   const factory = prepareFactoryText(meta.factory, source, options.filePath, moduleName, interfaceModule);
   const [leadingData, trailingData] = getSourceRoundRootBlock(source, meta);

   // In case of static dependencies
   if (Array.isArray(meta.dependencies)) {
      const dependencies = meta.dependencies.map(v => req.normalizeDependency(v, moduleName, interfaceModule));
      const [cleanFactory, cleanDependencies] = prepareCleanFactory(meta.factory, source, dependencies);

      return {
         originModule: meta.originModule,
         keepSourceMap: options.keepSourceMap,
         factoryArguments: modifyFactoryArguments(meta.factoryArguments),
         moduleName,
         dependencies,
         factory,
         cleanFactory,
         cleanDependencies,
         leadingData,
         trailingData
      };
   }

   // In case of dynamic dependencies
   if (meta.dependenciesCallback) {
      const dependenciesCall = source.slice(
         meta.dependenciesCallback.range[0],
         meta.dependenciesCallback.range[1]
      );

      return {
         originModule: meta.originModule,
         keepSourceMap: options.keepSourceMap,
         moduleName,
         dependenciesCall,
         factory,
         leadingData,
         trailingData
      };
   }

   return {
      originModule: meta.originModule,
      keepSourceMap: options.keepSourceMap,
      moduleName,
      factory,
      leadingData,
      trailingData
   };
}

function prepare(program, source, meta, options) {
   const factory = source.slice(meta.factory.range[0], meta.factory.range[1]);
   const [leadingData, trailingData] = getSourceRoundRootBlock(source, meta);

   // In case of static dependencies
   if (Array.isArray(meta.dependencies)) {
      return {
         originModule: meta.originModule,
         keepSourceMap: options.keepSourceMap,
         moduleName: meta.moduleName,
         dependencies: meta.dependencies,
         factoryArguments: modifyFactoryArguments(meta.factoryArguments),
         factory,
         leadingData,
         trailingData
      };
   }

   // In case of dynamic dependencies
   if (meta.dependenciesCallback) {
      const dependenciesCall = source.slice(
         meta.dependenciesCallback.range[0],
         meta.dependenciesCallback.range[1]
      );

      return {
         originModule: meta.originModule,
         keepSourceMap: options.keepSourceMap,
         moduleName: meta.moduleName,
         dependenciesCall,
         factory,
         leadingData,
         trailingData
      };
   }

   return {
      originModule: meta.originModule,
      keepSourceMap: options.keepSourceMap,
      moduleName: meta.moduleName,
      factory,
      leadingData,
      trailingData
   };
}

module.exports = (program, source, meta, options) => {
   if (options.isCompiledFromTsc) {
      return modify(program, source, meta, options);
   }

   return prepare(program, source, meta, options);
};
