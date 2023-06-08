/**
 * @author Krylov M.A.
 */

'use strict';

const amd = require('./amd');
const umd = require('./umd-saby');
const patch = require('./patch');
const modify = require('./modifier');

const toDefaultFactory = content => `function(require, exports) {
${content}
}`;

function formatUnknown(components, targetModule) {
   // tsc не оборачивает в amd/umd, если, например, модуль не содержит export выражений.
   // для amd необходимо сделать обертку, а umd отдать как есть.
   if (targetModule === 'umd') {
      return components.factory;
   }

   return amd.format({
      moduleName: components.moduleName,
      dependencies: ['require', 'exports'],
      factory: toDefaultFactory(components.factory)
   });
}

function format(components, target) {
   const targetModule = target.toLowerCase();

   if (!components.originModule && !components.moduleName.endsWith('.routes')) {
      return formatUnknown(components, targetModule);
   }

   if (targetModule === 'umd') {
      const shouldUseClassicFormat = (
         components.keepSourceMap ||
         components.originModule === 'umd'
      );

      if (shouldUseClassicFormat) {
         return umd.formatClassic(components);
      }

      return umd.format(components);
   }

   if (components.originModule === 'amd') {
      return amd.format(components);
   }

   return amd.format({
      ...components,
      factory: components.cleanFactory || components.factory,
      dependencies: components.cleanDependencies || components.dependencies
   });
}

function compile(components, target) {
   return (
      components.leadingData +
      format(components, target) +
      components.trailingData
   );
}

function parse(program, options) {
   const meta = amd.parse(program) || umd.parse(program);

   if (meta) {
      return meta;
   }

   if (options.isCompiledFromTsc && !options.isRoutesFile) {
      return {
         factory: program
      };
   }

   return undefined;
}

function convert(program, source, target, options) {
   const result = {
      hasError: true
   };

   try {
      const [pProgram, pSource] = patch(program, source);
      const meta = parse(pProgram, options);

      if (!meta || meta.hasError) {
         return result;
      }

      const components = modify(pProgram, pSource, meta, options);
      const targets = Array.isArray(target) ? target : [target];
      for (const moduleName of targets) {
         result[moduleName] = compile(components, moduleName);
      }

      result.hasError = false;
   } catch (error) {
      result.error = error;
   }

   return result;
}

module.exports = convert;
